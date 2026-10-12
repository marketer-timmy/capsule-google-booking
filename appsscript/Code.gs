/**
 * capsule-google-booking, Track A: one person, no middleware.
 *
 * Runs inside your own Google account as an Apps Script project. Free. Two jobs:
 *
 *   doPost             The booking form on your page posts here (step 1). Finds or creates the
 *                      person in Capsule, opens an opportunity at NEW (or reuses the open one),
 *                      and writes a note carrying the attribution.
 *   onCalendarChanged  Fired by a calendar trigger whenever your calendar changes, plus a
 *                      15-minute safety timer. Reads what changed, keeps events with an outside
 *                      guest, moves the opportunity to MEETING BOOKED, tags it, writes a note.
 *                      Cancellations get a booking:cancelled tag and a note.
 *
 * Set-up (docs/LESSON-PLAN.md, Track A, about 25 minutes):
 *   1. script.google.com > New project. Replace Code.gs with this file. Project Settings > tick
 *      "Show appsscript.json", then replace that file with the one in this folder.
 *   2. Project Settings > Script Properties: CAPSULE_TOKEN (your Capsule personal access token)
 *      and FORM_SECRET (any long random string; the same value goes into the page).
 *   3. Edit CONFIG below. Run setup() from the editor once and approve the permissions it asks for.
 *      It checks the token, warns about missing milestones, and installs the two triggers.
 *   4. Deploy > New deployment > Web app > Execute as Me, Who has access: Anyone. Copy the URL
 *      into SCRIPT_URL in the page. Later code changes need Deploy > Manage deployments > Edit >
 *      New version, which keeps the same URL.
 */

var CONFIG = {
  CAPSULE_BASE: 'https://api.capsulecrm.com/api/v2',
  PIPELINE_NAME: '',                  // '' uses the account's first (or only) pipeline
  NEW_MILESTONE: 'New',
  BOOKED_MILESTONE: 'Meeting Booked',
  MOVE_FROM: ['New', 'Contacted'],    // the watcher only moves an opportunity forward from these
  CALENDAR_ID: 'primary',             // 'primary' = the calendar of the account running the script
  INTERNAL_DOMAINS: ['example.co.nz'],// attendees on these domains are you, not guests
  SUMMARY_MATCH: ['quick chat', 'conversation'], // only events whose title contains one of these; [] = any outside guest
  MEETING_TYPES: {
    quick:        { label: 'A quick chat (10 min)',  match: 'quick chat' },
    conversation: { label: 'A conversation (40 min)', match: 'conversation' },
  },
  TAGS: ['form:booking'],
  TAG_PREFIX: 'booking',
  ATTRIBUTION_TAG: 'Attribution',
  ATTRIBUTION_FIELDS: [],             // DataTag field names once the DataTag exists; [] = attribution in the note only
  TIMEZONE: 'Pacific/Auckland',
  LOOKBACK_HOURS: 24,                 // how far back the first calendar sync looks
  SAFETY_MINUTES: 15,                 // timer that runs the watcher even if a calendar trigger is missed
};

// ---------------------------------------------------------------------------
// Run once from the editor
// ---------------------------------------------------------------------------

function setup() {
  if (!prop_('CAPSULE_TOKEN')) throw new Error('Add CAPSULE_TOKEN under Project Settings > Script Properties first.');
  var me = capsule_('GET', '/users/current');
  Logger.log('Capsule token works. Acting as: ' + (me.user && (me.user.username || me.user.name)));

  var ms = milestones_();
  Logger.log('Milestones in pipeline "' + pipelineLabel_() + '": ' + ms.map(function (m) { return m.name; }).join(', '));
  [CONFIG.NEW_MILESTONE, CONFIG.BOOKED_MILESTONE].forEach(function (name) {
    if (!findMilestone_(ms, name)) Logger.log('WARNING: no milestone called "' + name + '". Run createMilestones() or change CONFIG.');
  });

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onCalendarChanged') ScriptApp.deleteTrigger(t);
  });
  var cal = CONFIG.CALENDAR_ID === 'primary' ? Session.getEffectiveUser().getEmail() : CONFIG.CALENDAR_ID;
  ScriptApp.newTrigger('onCalendarChanged').forUserCalendar(cal).onEventUpdated().create();
  ScriptApp.newTrigger('onCalendarChanged').timeBased().everyMinutes(CONFIG.SAFETY_MINUTES).create();
  Logger.log('Triggers installed for ' + cal + '. Next: Deploy > New deployment > Web app.');
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

/** Simulates a form submission so you can check Capsule without touching the page. */
function testBooking() {
  var sample = {
    secret: prop_('FORM_SECRET'),
    first_name: 'Test', last_name: 'Booking', email: 'test.booking@example.com',
    meeting_type: Object.keys(CONFIG.MEETING_TYPES)[0], need: 'Trying the solo track',
    consent: true, utm_source: 'lesson', utm_campaign: 'track-a', booking_key: 'bk_test',
  };
  var out = handleForm_(sample);
  Logger.log(JSON.stringify(out));
}

/** Forgets what the watcher has seen and re-reads the last LOOKBACK_HOURS on the next run. */
function fullResync() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('syncToken');
  props.deleteProperty('processed');
  Logger.log('Cleared. The next run looks back ' + CONFIG.LOOKBACK_HOURS + ' hours.');
}

// ---------------------------------------------------------------------------
// Web app: the form posts here
// ---------------------------------------------------------------------------

function doGet() {
  return json_({ ok: true, service: 'capsule-google-booking', time: new Date().toISOString() });
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'body is not JSON' }); }
  var secret = prop_('FORM_SECRET');
  if (secret && body.secret !== secret) return json_({ ok: false, error: 'bad secret' });
  if (body.website) return json_({ ok: true, skipped: 'honeypot' });
  try {
    return json_(handleForm_(body));
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
// Calendar watcher
// ---------------------------------------------------------------------------

function onCalendarChanged() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var events = listChangedEvents_(props);
    if (!events.length) return;
    var processed = JSON.parse(props.getProperty('processed') || '{}');
    events.forEach(function (ev) {
      if (!ev.id || processed[ev.id] === ev.updated) return;
      processed[ev.id] = ev.updated;
      if (!summaryMatches_(ev.summary || '')) return;
      var guest = outsideGuest_(ev);
      if (!guest) return;
      try { handleBooking_(ev, guest); }
      catch (err) { console.error('Event ' + ev.id + ': ' + err); delete processed[ev.id]; }
    });
    var cutoff = Date.now() - 60 * 86400000;
    Object.keys(processed).forEach(function (id) { if (new Date(processed[id]).getTime() < cutoff) delete processed[id]; });
    props.setProperty('processed', JSON.stringify(processed));
  } finally {
    lock.releaseLock();
  }
}

/** Incremental sync with a sync token; falls back to a full sync over LOOKBACK_HOURS. */
function listChangedEvents_(props) {
  var opts = { maxResults: 250, showDeleted: true, singleEvents: true };
  var syncToken = props.getProperty('syncToken');
  if (syncToken) opts.syncToken = syncToken;
  else opts.timeMin = new Date(Date.now() - CONFIG.LOOKBACK_HOURS * 3600000).toISOString();
  var items = [], pageToken = null, res;
  do {
    if (pageToken) opts.pageToken = pageToken;
    try {
      res = Calendar.Events.list(CONFIG.CALENDAR_ID, opts);
    } catch (err) {
      var msg = String(err && err.message || err);
      if (syncToken && (msg.indexOf('full sync') !== -1 || msg.indexOf('410') !== -1)) {
        props.deleteProperty('syncToken');
        return listChangedEvents_(props);
      }
      throw err;
    }
    items = items.concat(res.items || []);
    pageToken = res.nextPageToken || null;
    if (!pageToken && res.nextSyncToken) props.setProperty('syncToken', res.nextSyncToken);
  } while (pageToken);
  return items;
}

function handleBooking_(ev, guest) {
  var action = ev.status === 'cancelled' ? 'cancelled' : 'booked';
  var email = String(guest.email).toLowerCase();
  var parts = guestName_(ev, guest).split(/\s+/);
  var partyId = findOrCreatePerson_(email, parts[0], parts.slice(1).join(' '), ['form:booking', 'src:calendar-direct'], []);
  var typeKey = meetingType_(ev.summary || '');
  var tags = [action === 'cancelled' ? CONFIG.TAG_PREFIX + ':cancelled' : CONFIG.TAG_PREFIX + ':' + typeKey];
  var opp = openOpportunity_(partyId);
  var oppId = null;
  if (opp) {
    oppId = opp.id;
    var body = { opportunity: { tags: toTags_(tags) } };
    if (action === 'booked') {
      var booked = findMilestone_(milestones_(), CONFIG.BOOKED_MILESTONE);
      var from = (opp.milestone && opp.milestone.name || '').toLowerCase();
      var allowed = CONFIG.MOVE_FROM.map(function (m) { return m.toLowerCase(); });
      if (booked && (!opp.milestone || allowed.indexOf(from) !== -1)) body.opportunity.milestone = { id: booked.id };
    }
    capsule_('PUT', '/opportunities/' + oppId, body);
  } else if (action === 'booked') {
    var bookedMs = findMilestone_(milestones_(), CONFIG.BOOKED_MILESTONE);
    if (!bookedMs) throw new Error('No milestone called "' + CONFIG.BOOKED_MILESTONE + '" in pipeline "' + pipelineLabel_() + '"');
    var name = ((guest.displayName || email) + ' - ' + (ev.summary || 'Meeting')).slice(0, 100);
    var r = capsule_('POST', '/opportunities', { opportunity: {
      party: { id: partyId }, name: name, milestone: { id: bookedMs.id }, tags: toTags_(tags),
    } });
    oppId = r.opportunity.id;
  }
  note_(partyId, oppId, bookingNote_(ev, action));
}

function bookingNote_(ev, action) {
  var start = ev.start && (ev.start.dateTime || ev.start.date);
  var when = start ? Utilities.formatDate(new Date(start), CONFIG.TIMEZONE, 'EEEE d MMMM yyyy, h:mm a') : 'unknown time';
  if (action === 'cancelled') {
    return ['Meeting cancelled: ' + (ev.summary || ''), 'Was: ' + when, 'Event id: ' + ev.id].join('\n');
  }
  return [
    'Meeting booked: ' + (ev.summary || ''),
    'When: ' + when,
    ev.hangoutLink ? 'Meet: ' + ev.hangoutLink : null,
    ev.htmlLink ? 'Calendar: ' + ev.htmlLink : null,
    ev.description ? 'Booking form answers:\n' + String(ev.description).slice(0, 1500) : null,
    'Event id: ' + ev.id,
  ].filter(Boolean).join('\n');
}

/** The guest's name: Google omits displayName for booking-page guests, but writes it into the event. */
function guestName_(ev, guest) {
  if (guest.displayName) return String(guest.displayName).trim();
  var desc = String(ev.description || '').replace(/<[^>]+>/g, '\n');
  var m = desc.match(/Booked by\s*\n+\s*([^\n]+)/i);
  if (m && m[1].trim()) return m[1].trim();
  var s = String(ev.summary || '').match(/\(([^()]+)\)\s*$/);
  if (s && s[1].trim()) return s[1].trim();
  return String(guest.email).split('@')[0];
}

function outsideGuest_(ev) {
  var internal = CONFIG.INTERNAL_DOMAINS.map(function (d) { return d.toLowerCase(); });
  var list = (ev.attendees || []).filter(function (a) {
    if (!a.email || a.resource || a.self || a.organizer) return false;
    var domain = String(a.email).toLowerCase().split('@')[1] || '';
    return internal.indexOf(domain) === -1;
  });
  return list[0] || null;
}

function summaryMatches_(summary) {
  if (!CONFIG.SUMMARY_MATCH.length) return true;
  var s = summary.toLowerCase();
  return CONFIG.SUMMARY_MATCH.some(function (m) { return s.indexOf(String(m).toLowerCase()) !== -1; });
}

function meetingType_(summary) {
  var s = summary.toLowerCase();
  var keys = Object.keys(CONFIG.MEETING_TYPES);
  for (var i = 0; i < keys.length; i++) {
    var m = String(CONFIG.MEETING_TYPES[keys[i]].match || keys[i]).toLowerCase();
    if (s.indexOf(m) !== -1) return keys[i];
  }
  return 'meeting';
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
