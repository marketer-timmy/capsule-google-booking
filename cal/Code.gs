/**
 * capsule-google-booking, Track C: one person, Cal.com instead of Google's booking page.
 *
 * Runs inside your own Google account as an Apps Script project. Free. One web app, two callers:
 *
 *   the form      The booking form on your page posts here (step 1). Finds or creates the person
 *                 in Capsule, opens an opportunity at NEW (or reuses the open one), and writes a
 *                 note carrying the attribution. Same as Track A.
 *   Cal.com       A Cal.com webhook posts here when a booking is created, rescheduled or
 *                 cancelled. The opportunity moves to MEETING BOOKED, gets a tag and a note.
 *                 There is no calendar watcher and no timer: Cal.com tells the script.
 *
 * The page passes a booking key to Cal.com as metadata, and Cal.com hands it back in the webhook,
 * so the booking joins the form record even when the visitor books under a different email.
 *
 * Set-up (docs/LESSON-PLAN.md, Track C, about 25 minutes):
 *   1. script.google.com > New project. Replace Code.gs with this file. Project Settings > tick
 *      "Show appsscript.json", then replace that file with the one in this folder.
 *   2. Project Settings > Script Properties: CAPSULE_TOKEN (your Capsule personal access token),
 *      FORM_SECRET (any long random string; the same value goes into the page) and
 *      WEBHOOK_KEY (another long random string; it goes on the end of the webhook URL).
 *   3. Edit CONFIG below. Run setup() from the editor once and approve the permissions it asks for.
 *   4. Deploy > New deployment > Web app > Execute as Me, Who has access: Anyone. Copy the URL
 *      into SCRIPT_URL in the page.
 *   5. Cal.com > Settings > Developer > Webhooks > New. Subscriber URL is the web app URL with
 *      ?key=<WEBHOOK_KEY> on the end. Tick Booking created, Booking rescheduled and Booking
 *      cancelled. Leave the payload template on the default.
 *
 * Why a key in the URL and not Cal.com's signing secret: Cal.com signs each webhook in an
 * X-Cal-Signature-256 header, and an Apps Script web app cannot read request headers. The key in
 * the URL is the check this script can make. Treat the full URL as a password.
 */

var CONFIG = {
  CAPSULE_BASE: 'https://api.capsulecrm.com/api/v2',
  PIPELINE_NAME: '',                  // '' uses the account's first (or only) pipeline
  NEW_MILESTONE: 'New',
  BOOKED_MILESTONE: 'Meeting Booked',
  MOVE_FROM: ['New', 'Contacted'],    // a booking only moves an opportunity forward from these
  MEETING_TYPES: {                    // slug = the last part of the Cal.com booking link
    quick:        { label: 'A quick chat (10 min)',  slug: 'quick-chat' },
    conversation: { label: 'A conversation (40 min)', slug: 'conversation' },
  },
  TAGS: ['form:booking'],
  TAG_PREFIX: 'booking',
  ATTRIBUTION_TAG: 'Attribution',
  ATTRIBUTION_FIELDS: [],             // DataTag field names once the DataTag exists; [] = attribution in the note only
  TIMEZONE: 'Pacific/Auckland',
  LEAD_DAYS: 30,                      // how long a booking key is remembered between the form and the booking
};

// ---------------------------------------------------------------------------
// Run once from the editor
// ---------------------------------------------------------------------------

function setup() {
  if (!prop_('CAPSULE_TOKEN')) throw new Error('Add CAPSULE_TOKEN under Project Settings > Script Properties first.');
  if (!prop_('WEBHOOK_KEY')) Logger.log('WARNING: no WEBHOOK_KEY script property. Anyone who finds the web app URL could post a fake booking.');
  var me = capsule_('GET', '/users/current');
  Logger.log('Capsule token works. Acting as: ' + (me.user && (me.user.username || me.user.name)));
  var ms = milestones_();
  Logger.log('Milestones in pipeline "' + pipelineLabel_() + '": ' + ms.map(function (m) { return m.name; }).join(', '));
  [CONFIG.NEW_MILESTONE, CONFIG.BOOKED_MILESTONE].forEach(function (name) {
    if (!findMilestone_(ms, name)) Logger.log('WARNING: no milestone called "' + name + '". Run createMilestones() or change CONFIG.');
  });
  Logger.log('Next: Deploy > New deployment > Web app, then add the webhook in Cal.com.');
}

/** Adds the milestones the recipe expects to the configured pipeline, skipping any that exist. */
function createMilestones() {
  var pipeline = pipeline_();
  var existing = milestones_();
  var wanted = [[CONFIG.NEW_MILESTONE, 10], ['Contacted', 20], [CONFIG.BOOKED_MILESTONE, 40], ['Meeting Held', 60]];
  wanted.forEach(function (pair) {
    if (findMilestone_(existing, pair[0])) { Logger.log('Exists: ' + pair[0]); return; }
    var body = { milestone: { name: pair[0], probability: pair[1] } };
    if (pipeline) body.milestone.pipeline = { id: pipeline.id };
    var r = capsule_('POST', '/milestones', body);
    Logger.log('Created: ' + pair[0] + ' (id ' + (r.milestone && r.milestone.id) + ')');
  });
}

/** Simulates a form submission, then the Cal.com webhook for it, so you can check Capsule end to end. */
function testBooking() {
  var typeKey = Object.keys(CONFIG.MEETING_TYPES)[0];
  var form = {
    secret: prop_('FORM_SECRET'),
    first_name: 'Test', last_name: 'Booking', email: 'test.booking@example.com',
    meeting_type: typeKey, need: 'Trying the Cal.com track',
    consent: true, utm_source: 'lesson', utm_campaign: 'track-c', booking_key: 'bk_test',
  };
  var out = handleForm_(form);
  Logger.log('Form: ' + JSON.stringify(out));
  if (out.ok) remember_(form.booking_key, out.party_id);
  var start = new Date(Date.now() + 86400000);
  var hook = { triggerEvent: 'BOOKING_CREATED', createdAt: new Date().toISOString(), payload: {
    uid: 'test_' + Date.now().toString(36), type: CONFIG.MEETING_TYPES[typeKey].slug,
    title: 'Test booking', startTime: start.toISOString(),
    endTime: new Date(start.getTime() + 600000).toISOString(),
    attendees: [{ name: 'Test Booking', email: 'test.booking@example.com', timeZone: CONFIG.TIMEZONE }],
    responses: { notes: { label: 'Additional notes', value: 'Sent by testBooking()' } },
    metadata: { booking_key: 'bk_test', videoCallUrl: 'https://example.com/call' },
  } };
  Logger.log('Webhook: ' + JSON.stringify(handleCal_(hook)));
}

// ---------------------------------------------------------------------------
// Web app: the form and Cal.com both post here
// ---------------------------------------------------------------------------

function doGet() {
  return json_({ ok: true, service: 'capsule-google-booking (cal.com track)', time: new Date().toISOString() });
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'body is not JSON' }); }
  try {
    if (body.triggerEvent) {
      var key = prop_('WEBHOOK_KEY');
      if (key && String((e.parameter && e.parameter.key) || '') !== key) return json_({ ok: false, error: 'bad key' });
      return json_(handleCal_(body));
    }
    var secret = prop_('FORM_SECRET');
    if (secret && body.secret !== secret) return json_({ ok: false, error: 'bad secret' });
    if (body.website) return json_({ ok: true, skipped: 'honeypot' });
    var out = handleForm_(body);
    if (out.ok && body.booking_key) remember_(String(body.booking_key).slice(0, 40), out.party_id);
    return json_(out);
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function handleForm_(body) {
  var lead = normalise_(body);
  if (lead.errors.length) return { ok: false, errors: lead.errors };
  var partyId = findOrCreatePerson_(lead.email, lead.first_name, lead.last_name, lead.tags, lead.fields);
  var opp = openOpportunity_(partyId);
  var oppId;
  if (opp) {
    oppId = opp.id;
    capsule_('PUT', '/opportunities/' + oppId, { opportunity: { tags: toTags_(lead.opportunity_tags) } });
  } else {
    var ms = milestones_();
    var newMs = findMilestone_(ms, CONFIG.NEW_MILESTONE) || ms[0];
    if (!newMs) throw new Error('No milestone called "' + CONFIG.NEW_MILESTONE + '" in pipeline "' + pipelineLabel_() + '"');
    var name = ((lead.first_name + ' ' + lead.last_name).trim() + ' - ' + lead.meeting_label).slice(0, 100);
    var r = capsule_('POST', '/opportunities', { opportunity: {
      party: { id: partyId }, name: name, milestone: { id: newMs.id }, tags: toTags_(lead.opportunity_tags),
    } });
    oppId = r.opportunity.id;
  }
  note_(partyId, oppId, requestNote_(lead));
  return { ok: true, party_id: partyId, opportunity_id: oppId };
}

function normalise_(b) {
  var s = function (v) { return (v === undefined || v === null) ? '' : String(v).trim(); };
  var email = s(b.email).toLowerCase();
  var first = s(b.first_name || b.firstName).slice(0, 80);
  var last = s(b.last_name || b.lastName).slice(0, 80);
  var typeKey = s(b.meeting_type).toLowerCase();
  if (!CONFIG.MEETING_TYPES[typeKey]) typeKey = Object.keys(CONFIG.MEETING_TYPES)[0];
  var errors = [];
  if (!first) errors.push('first_name');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push('email');
  var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
              'gclid', 'gbraid', 'wbraid', 'fbclid', 'ttclid', 'msclkid', 'landing_url', 'referrer', 'page_url'];
  var attribution = {};
  keys.forEach(function (k) { var v = s(b[k]); if (v) attribution[k] = v.slice(0, 250); });
  var bookingKey = s(b.booking_key).slice(0, 40) || ('bk_' + Date.now().toString(36));
  var tags = CONFIG.TAGS.concat([CONFIG.TAG_PREFIX + ':' + typeKey]);
  if (attribution.utm_source) tags.push(('src:' + attribution.utm_source).slice(0, 50));
  var values = Object.assign({}, attribution, { booking_key: bookingKey });
  // Capsule wants the DataTag's id next to a field named by name; the id is looked up once and cached.
  var tagId = CONFIG.ATTRIBUTION_FIELDS.length ? dataTagId_(CONFIG.ATTRIBUTION_TAG) : null;
  var fields = !tagId ? [] : CONFIG.ATTRIBUTION_FIELDS.filter(function (n) { return values[n]; }).map(function (n) {
    return { definition: { name: n, tag: tagId }, value: String(values[n]).slice(0, 250) };
  });
  if (fields.length) tags.push(CONFIG.ATTRIBUTION_TAG);
  return {
    errors: errors, email: email, first_name: first, last_name: last,
    meeting_type: typeKey, meeting_label: CONFIG.MEETING_TYPES[typeKey].label,
    need: s(b.need).slice(0, 1000), attribution: attribution, booking_key: bookingKey,
    tags: unique_(tags), fields: fields, received_at: new Date().toISOString(),
    // the DataTag belongs on the person only; the opportunity gets the plain tags
    opportunity_tags: unique_(tags).filter(function (t) { return t !== CONFIG.ATTRIBUTION_TAG; }),
  };
}

function requestNote_(lead) {
  var attr = Object.keys(lead.attribution).map(function (k) { return k + ': ' + lead.attribution[k]; }).join('\n');
  return [
    'Booking requested: ' + lead.meeting_label,
    lead.need ? 'What they need: ' + lead.need : null,
    'Booking key: ' + lead.booking_key,
    attr ? 'Attribution:\n' + attr : 'Attribution: nothing captured',
    'Received: ' + lead.received_at,
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// Cal.com webhook
// ---------------------------------------------------------------------------

var CAL_ACTIONS = { BOOKING_CREATED: 'booked', BOOKING_RESCHEDULED: 'rescheduled', BOOKING_CANCELLED: 'cancelled' };

function handleCal_(body) {
  var trigger = String(body.triggerEvent || '');
  var action = CAL_ACTIONS[trigger];
  if (!action) return { ok: true, skipped: trigger };   // Cal.com's ping test and any trigger this script ignores
  var p = body.payload || {};
  var uid = String(p.uid || p.bookingId || '');
  var guest = calGuest_(p);
  if (!guest.email) return { ok: false, error: 'no attendee email in the payload' };

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var seenKey = uid + ':' + trigger;
    if (uid && seen_(seenKey)) return { ok: true, skipped: 'already handled' };

    var bookingKey = String((p.metadata && p.metadata.booking_key) || '');
    var partyId = bookingKey ? recall_(bookingKey) : null;
    var joined = partyId ? 'booking key' : 'email';
    if (!partyId) {
      var parts = guest.name.split(/\s+/);
      partyId = findOrCreatePerson_(guest.email, parts[0], parts.slice(1).join(' '), CONFIG.TAGS.concat(['src:cal-direct']), []);
    }

    var typeKey = calMeetingType_(p.type);
    var tags = [action === 'cancelled' ? CONFIG.TAG_PREFIX + ':cancelled' : CONFIG.TAG_PREFIX + ':' + typeKey];
    var opp = openOpportunity_(partyId);
    var oppId = null;
    if (opp) {
      oppId = opp.id;
      var change = { opportunity: { tags: toTags_(tags) } };
      if (action !== 'cancelled') {
        var booked = findMilestone_(milestones_(), CONFIG.BOOKED_MILESTONE);
        var from = (opp.milestone && opp.milestone.name || '').toLowerCase();
        var allowed = CONFIG.MOVE_FROM.map(function (m) { return m.toLowerCase(); });
        if (booked && (!opp.milestone || allowed.indexOf(from) !== -1)) change.opportunity.milestone = { id: booked.id };
      }
      capsule_('PUT', '/opportunities/' + oppId, change);
    } else if (action !== 'cancelled') {
      var bookedMs = findMilestone_(milestones_(), CONFIG.BOOKED_MILESTONE);
      if (!bookedMs) throw new Error('No milestone called "' + CONFIG.BOOKED_MILESTONE + '" in pipeline "' + pipelineLabel_() + '"');
      var name = (guest.name + ' - ' + (p.eventTitle || p.title || 'Meeting')).slice(0, 100);
      var r = capsule_('POST', '/opportunities', { opportunity: {
        party: { id: partyId }, name: name, milestone: { id: bookedMs.id }, tags: toTags_(tags),
      } });
      oppId = r.opportunity.id;
    }
    note_(partyId, oppId, calNote_(p, action, bookingKey));
    if (uid) markSeen_(seenKey);
    return { ok: true, action: action, party_id: partyId, opportunity_id: oppId, joined_by: joined };
  } finally {
    lock.releaseLock();
  }
}

/** The person who booked: the first attendee, with the form answers as a fallback. */
function calGuest_(p) {
  var a = (p.attendees || [])[0] || {};
  var resp = p.responses || {};
  var val = function (k) { var v = resp[k] && resp[k].value; return (v && typeof v === 'object') ? [v.firstName, v.lastName].filter(Boolean).join(' ') : String(v || ''); };
  var email = String(a.email || val('email')).trim().toLowerCase();
  var name = String(a.name || val('name')).trim() || email.split('@')[0];
  return { email: email, name: name, timeZone: a.timeZone || '' };
}

/** Cal.com sends the booking link's slug as `type`; match it to a meeting type key. */
function calMeetingType_(slug) {
  var s = String(slug || '').toLowerCase();
  var keys = Object.keys(CONFIG.MEETING_TYPES);
  for (var i = 0; i < keys.length; i++) {
    if (String(CONFIG.MEETING_TYPES[keys[i]].slug || keys[i]).toLowerCase() === s) return keys[i];
  }
  return 'meeting';
}

function calNote_(p, action, bookingKey) {
  var fmt = function (iso) { return iso ? Utilities.formatDate(new Date(iso), CONFIG.TIMEZONE, 'EEEE d MMMM yyyy, h:mm a') : 'unknown time'; };
  var title = p.eventTitle || p.title || '';
  if (action === 'cancelled') {
    return ['Meeting cancelled: ' + title, 'Was: ' + fmt(p.startTime),
            p.cancellationReason ? 'Reason: ' + String(p.cancellationReason).slice(0, 500) : null,
            'Cal.com booking: ' + (p.uid || '')].filter(Boolean).join('\n');
  }
  var skip = { name: 1, email: 1, guests: 1, location: 1 };
  var resp = p.responses || {};
  var answers = Object.keys(resp).filter(function (k) {
    var v = resp[k] && resp[k].value;
    return !skip[k] && v !== undefined && v !== null && String(v) !== '' && !(Array.isArray(v) && !v.length);
  }).map(function (k) {
    var v = resp[k].value;
    return (resp[k].label || k) + ': ' + (typeof v === 'object' ? JSON.stringify(v) : String(v));
  }).join('\n');
  var link = (p.metadata && p.metadata.videoCallUrl) || (p.videoCallData && p.videoCallData.url) || '';
  return [
    (action === 'rescheduled' ? 'Meeting rescheduled: ' : 'Meeting booked: ') + title,
    'When: ' + fmt(p.startTime),
    action === 'rescheduled' && p.rescheduleStartTime ? 'Was: ' + fmt(p.rescheduleStartTime) : null,
    link ? 'Call link: ' + link : null,
    answers ? 'Booking form answers:\n' + answers.slice(0, 1500) : null,
    bookingKey ? 'Booking key: ' + bookingKey : 'Booking key: none (booked from a direct Cal.com link)',
    'Cal.com booking: ' + (p.uid || ''),
    action === 'rescheduled' && p.rescheduleUid ? 'Replaces booking: ' + p.rescheduleUid : null,
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// Memory between the form and the booking (Script Properties)
// ---------------------------------------------------------------------------

/** Remembers which Capsule person a booking key belongs to, and forgets keys older than LEAD_DAYS. */
function remember_(bookingKey, partyId) {
  if (!bookingKey || !partyId) return;
  var props = PropertiesService.getScriptProperties();
  props.setProperty('lead:' + bookingKey, partyId + '|' + Date.now());
  var all = props.getProperties();
  var cutoff = Date.now() - CONFIG.LEAD_DAYS * 86400000;
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('lead:') === 0 && Number(String(all[k]).split('|')[1] || 0) < cutoff) props.deleteProperty(k);
  });
}

function recall_(bookingKey) {
  var v = prop_('lead:' + String(bookingKey).slice(0, 40));
  var id = v ? Number(v.split('|')[0]) : 0;
  return id || null;
}

function seen_(key) { return !!JSON.parse(prop_('seen') || '{}')[key]; }

function markSeen_(key) {
  var seen = JSON.parse(prop_('seen') || '{}');
  seen[key] = Date.now();
  var cutoff = Date.now() - 60 * 86400000;
  Object.keys(seen).forEach(function (k) { if (seen[k] < cutoff) delete seen[k]; });
  PropertiesService.getScriptProperties().setProperty('seen', JSON.stringify(seen));
}

// ---------------------------------------------------------------------------
// Capsule helpers
// ---------------------------------------------------------------------------

function findOrCreatePerson_(email, first, last, tags, fields) {
  var res = capsule_('GET', '/parties/search?q=' + encodeURIComponent(email) + '&perPage=20');
  var match = (res.parties || []).filter(function (p) {
    return (p.emailAddresses || []).some(function (e) { return String(e.address || '').toLowerCase() === email; });
  })[0];
  if (match) return match.id;
  var party = { type: 'person', firstName: first || email, emailAddresses: [{ type: 'Work', address: email }], tags: toTags_(tags) };
  if (last) party.lastName = last;
  if (fields && fields.length) party.fields = fields;
  var r = capsule_('POST', '/parties', { party: party });
  return r.party.id;
}

function openOpportunity_(partyId) {
  var opps = (capsule_('GET', '/parties/' + partyId + '/opportunities').opportunities) || [];
  var ids = milestones_().map(function (m) { return m.id; });
  var open = opps.filter(function (o) {
    return !o.closedOn && (!o.milestone || !ids.length || ids.indexOf(o.milestone.id) !== -1);
  }).sort(function (a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); });
  return open[0] || null;
}

function note_(partyId, oppId, content) {
  var entry = { type: 'note', party: { id: partyId }, content: content };
  if (oppId) entry.opportunity = { id: oppId };
  capsule_('POST', '/entries', { entry: entry });
}

var pipelineCache_ = null;
function pipeline_() {
  if (pipelineCache_ !== null) return pipelineCache_ || null;
  var list = [];
  try { list = capsule_('GET', '/pipelines').pipelines || []; } catch (err) { list = []; }
  var pick = null;
  if (CONFIG.PIPELINE_NAME) {
    pick = list.filter(function (p) { return String(p.name).toLowerCase() === CONFIG.PIPELINE_NAME.toLowerCase(); })[0] || null;
    if (!pick) throw new Error('No pipeline called "' + CONFIG.PIPELINE_NAME + '"');
  } else {
    pick = list[0] || null;
  }
  pipelineCache_ = pick || false;
  return pick;
}

var milestoneCache_ = null;
function milestones_() {
  if (milestoneCache_) return milestoneCache_;
  var p = pipeline_();
  var path = p ? '/pipelines/' + p.id + '/milestones' : '/milestones';
  milestoneCache_ = capsule_('GET', path + '?perPage=100').milestones || [];
  return milestoneCache_;
}

function pipelineLabel_() { var p = pipeline_(); return p ? p.name : 'default'; }

var dataTagCache_ = {};
/** The id of a DataTag by name, or null when the account has no such DataTag (fields are then skipped). */
function dataTagId_(name) {
  if (name in dataTagCache_) return dataTagCache_[name];
  var tags = capsule_('GET', '/parties/tags?perPage=100').tags || [];
  var hit = tags.filter(function (t) { return t.dataTag && String(t.name).toLowerCase() === String(name).toLowerCase(); })[0];
  dataTagCache_[name] = hit ? hit.id : null;
  return dataTagCache_[name];
}

function findMilestone_(list, name) {
  var n = String(name).toLowerCase();
  return list.filter(function (m) { return String(m.name).toLowerCase() === n; })[0] || null;
}

function capsule_(method, path, body) {
  var token = prop_('CAPSULE_TOKEN');
  if (!token) throw new Error('CAPSULE_TOKEN is missing from Script Properties');
  var opts = {
    method: method.toLowerCase(),
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    muteHttpExceptions: true,
  };
  if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  for (var attempt = 0; attempt < 3; attempt++) {
    var res = UrlFetchApp.fetch(CONFIG.CAPSULE_BASE + path, opts);
    var code = res.getResponseCode();
    if (code === 429 || code >= 500) { Utilities.sleep(2000 * (attempt + 1)); continue; }
    var text = res.getContentText() || '';
    if (code >= 400) throw new Error('Capsule ' + method + ' ' + path + ' returned ' + code + ': ' + text.slice(0, 300));
    return text ? JSON.parse(text) : {};
  }
  throw new Error('Capsule ' + method + ' ' + path + ' kept failing (rate limit or outage)');
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function prop_(name) { return PropertiesService.getScriptProperties().getProperty(name) || ''; }
function toTags_(names) { return unique_(names).map(function (n) { return { name: n }; }); }
function unique_(arr) { return arr.filter(function (v, i, a) { return v && a.indexOf(v) === i; }); }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
