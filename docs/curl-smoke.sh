#!/usr/bin/env bash
# docs/curl-smoke.sh
# Verify the mobile contract against a running backend.
# Usage:
#   BASE=http://localhost:8000 ./docs/curl-smoke.sh

set -euo pipefail
BASE="${BASE:-http://localhost:8000}"

echo "== 1. Enroll a demo patient =="
PID=$(curl -s -X POST "$BASE/api/patients" \
  -H 'content-type: application/json' \
  -d '{"name":"Smoke Patient","phone":"+15555550099","language":"en",
       "surgery_type":"lap_chole",
       "surgery_date":"2026-04-15T00:00:00Z",
       "discharge_date":"2026-04-17T00:00:00Z",
       "caregiver":{"name":"C","phone":"+15555550098"},
       "consent":{"recorded_at":"2026-04-17T00:00:00Z","ip":"127.0.0.1","version":"v1"}}' \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
echo "patient_id=$PID"

echo "== 2. Generate pairing code =="
PAIR_JSON=$(curl -s -X POST "$BASE/api/patients/$PID/pair")
CODE=$(echo "$PAIR_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin)["pairing_code"])')
echo "code=$CODE"

echo "== 3. Exchange code for token =="
EX_JSON=$(curl -s -X POST "$BASE/api/pair/exchange" \
  -H 'content-type: application/json' \
  -d "{\"code\":\"$CODE\",\"device_info\":{\"model\":\"CurlSmoke\",\"os\":\"bash\",\"app_version\":\"0.1.0\"}}")
TOKEN=$(echo "$EX_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin)["device_token"])')
DEVICE=$(echo "$EX_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin)["device_id"])')
echo "token[:20]=${TOKEN:0:20} device_id=$DEVICE"

echo "== 4. POST one vitals sample =="
BATCH=$(python3 -c 'import uuid;print(uuid.uuid4())')
NOW=$(python3 -c 'from datetime import datetime,timezone;print(datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))')
R=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/vitals/batch" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $BATCH" \
  -H 'content-type: application/json' \
  -d "{\"patient_id\":\"$PID\",\"device_id\":\"$DEVICE\",\"batch_id\":\"$BATCH\",
       \"samples\":[{\"t\":\"$NOW\",\"kind\":\"heart_rate\",\"value\":75,\"unit\":\"bpm\",
                      \"source\":\"apple_healthkit\",\"confidence\":null}]}")
BODY=$(echo "$R" | head -n -1); STATUS=$(echo "$R" | tail -n 1)
echo "status=$STATUS body=$BODY"
[ "$STATUS" = "202" ] || { echo "FAIL: expected 202"; exit 1; }

echo "== 5. Replay same batch - expect 200 idempotent =="
R=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/vitals/batch" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $BATCH" \
  -H 'content-type: application/json' \
  -d "{\"patient_id\":\"$PID\",\"device_id\":\"$DEVICE\",\"batch_id\":\"$BATCH\",
       \"samples\":[{\"t\":\"$NOW\",\"kind\":\"heart_rate\",\"value\":75,\"unit\":\"bpm\",
                      \"source\":\"apple_healthkit\",\"confidence\":null}]}")
STATUS=$(echo "$R" | tail -n 1)
echo "replay status=$STATUS"
[ "$STATUS" = "200" ] || { echo "FAIL: expected 200"; exit 1; }

echo "== 6. Send 1001 samples - expect 413 =="
python3 - <<PY >/tmp/big.json
import json, uuid
from datetime import datetime, timezone
bid = str(uuid.uuid4())
now = datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
print(json.dumps({
    "patient_id": "$PID", "device_id": "$DEVICE", "batch_id": bid,
    "samples": [{"t": now, "kind": "heart_rate", "value": 72,
                 "unit": "bpm", "source": "apple_healthkit", "confidence": None}] * 1001
}))
PY
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/vitals/batch" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $(python3 -c 'import uuid;print(uuid.uuid4())')" \
  -H 'content-type: application/json' --data-binary @/tmp/big.json)
echo "413 check status=$STATUS"
[ "$STATUS" = "413" ] || { echo "FAIL: expected 413"; exit 1; }

echo "== 7. Future timestamp - expect 400 clock_in_future =="
FUTURE=$(python3 -c 'from datetime import datetime, timezone, timedelta;print((datetime.now(tz=timezone.utc)+timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ"))')
BATCH2=$(python3 -c 'import uuid;print(uuid.uuid4())')
R=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/vitals/batch" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $BATCH2" \
  -H 'content-type: application/json' \
  -d "{\"patient_id\":\"$PID\",\"device_id\":\"$DEVICE\",\"batch_id\":\"$BATCH2\",
       \"samples\":[{\"t\":\"$FUTURE\",\"kind\":\"heart_rate\",\"value\":75,\"unit\":\"bpm\",
                      \"source\":\"apple_healthkit\",\"confidence\":null}]}")
STATUS=$(echo "$R" | tail -n 1); BODY=$(echo "$R" | head -n -1)
echo "clock_in_future status=$STATUS body=$BODY"
[ "$STATUS" = "400" ] || { echo "FAIL: expected 400"; exit 1; }

echo "== 8. Revoke device + retry -> 401 device_revoked =="
curl -s -X POST "$BASE/api/devices/$DEVICE/revoke" -o /dev/null -w 'revoke=%{http_code}\n'
BATCH3=$(python3 -c 'import uuid;print(uuid.uuid4())')
R=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/vitals/batch" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $BATCH3" \
  -H 'content-type: application/json' \
  -d "{\"patient_id\":\"$PID\",\"device_id\":\"$DEVICE\",\"batch_id\":\"$BATCH3\",
       \"samples\":[{\"t\":\"$NOW\",\"kind\":\"heart_rate\",\"value\":75,\"unit\":\"bpm\",
                      \"source\":\"apple_healthkit\",\"confidence\":null}]}")
STATUS=$(echo "$R" | tail -n 1); BODY=$(echo "$R" | head -n -1)
echo "revoked status=$STATUS body=$BODY"
[ "$STATUS" = "401" ] || { echo "FAIL: expected 401"; exit 1; }

echo
echo "ALL 8 CHECKS PASSED"
