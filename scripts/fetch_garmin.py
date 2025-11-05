# scripts/fetch_garmin.py
import os
import json
import base64
from pathlib import Path

import garth
from garminconnect import Garmin


def get_client():
    # 1) try session from base64
    session_b64 = os.environ.get("GARMIN_SESSION_B64")
    if session_b64:
        try:
            # decode base64 → json string
            raw = base64.b64decode(session_b64)
            data = json.loads(raw.decode())

            # create a temp dir and write the json there
            tmp_dir = Path("/tmp/garth_session")
            tmp_dir.mkdir(parents=True, exist_ok=True)
            session_file = tmp_dir / "session.json"
            session_file.write_text(json.dumps(data))

            # now tell garth to load that directory
            garth.client.load(str(tmp_dir))

            # create Garmin client that uses current garth session
            return Garmin()
        except Exception as e:
            print("⚠️ Failed to load session from GARMIN_SESSION_B64, will try username/password:", e)

    # 2) fallback to username/password (may fail on GitHub IPs, but we try)
    username = os.environ.get("GARMIN_USERNAME")
    password = os.environ.get("GARMIN_PASSWORD")
    if username and password:
        g = Garmin(username, password)
        g.login()
        return g

    raise RuntimeError("No valid session and no username/password available")


def main():
    client = get_client()

    activities = client.get_activities(0, 5)
    for a in activities:
        print(f"{a['startTimeLocal']} - {a['activityName']} - {a.get('distance', 0)}m")


if __name__ == "__main__":
    main()
