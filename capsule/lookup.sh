#!/usr/bin/env bash
# Read-only lookups against your Capsule account.
# Prints pipelines + milestones and the custom field definitions with their ids,
# which is everything the two n8n Settings nodes ask for.
#
#   export CAPSULE_TOKEN='...'   # My Preferences > API Authentication Tokens
#   bash capsule/lookup.sh
set -euo pipefail
: "${CAPSULE_TOKEN:?Set CAPSULE_TOKEN to a Capsule personal access token first}"
BASE="https://api.capsulecrm.com/api/v2"

get() {
  curl -sS --fail -H "Authorization: Bearer $CAPSULE_TOKEN" -H "Accept: application/json" "$BASE$1"
}

echo "== Pipelines and milestones"
get "/milestones?perPage=100" | python3 -c '
import json, sys
d = json.load(sys.stdin)
by = {}
for m in d.get("milestones", []):
    p = (m.get("pipeline") or {}).get("name", "(single pipeline)")
    by.setdefault(p, []).append(m)
for p, ms in by.items():
    print(f"  {p}")
    for m in ms:
        print(f"    {m[\"id\"]:>10}  {m[\"name\"]}" + ("  (complete)" if m.get("complete") else ""))
'

echo
echo "== Person field definitions (use these ids in attribution_field_ids)"
get "/parties/fields/definitions?perPage=100" | python3 -c '
import json, sys
d = json.load(sys.stdin)
for f in d.get("definitions", []):
    tag = (f.get("tag") or {}).get("name")
    print(f"  {f[\"id\"]:>10}  {f[\"name\"]:<24} {f.get(\"type\",\"\"):<10}" + (f"  DataTag: {tag}" if tag else ""))
'

echo
echo "== Opportunity field definitions"
get "/opportunities/fields/definitions?perPage=100" | python3 -c '
import json, sys
d = json.load(sys.stdin)
for f in d.get("definitions", []):
    tag = (f.get("tag") or {}).get("name")
    print(f"  {f[\"id\"]:>10}  {f[\"name\"]:<24} {f.get(\"type\",\"\"):<10}" + (f"  DataTag: {tag}" if tag else ""))
'
