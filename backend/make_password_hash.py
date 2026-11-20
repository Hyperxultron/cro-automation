"""
Dashboard login ka password hash + AUTH_SECRET banao (apne computer pe chalao):

    python make_password_hash.py

Password screen pe nahi dikhega. Output ki dono lines Render ke backend
service ke Environment mein paste karo. Password kabhi kisi ko chat mein mat bhejo.
"""

import getpass
import secrets

from auth import hash_password

pw = getpass.getpass("New dashboard password: ")
if len(pw) < 10:
    raise SystemExit("Password kam se kam 10 characters ka rakho.")
if getpass.getpass("Type it again: ") != pw:
    raise SystemExit("Dono password match nahi hue.")

print()
print("DASHBOARD_PASSWORD_HASH=" + hash_password(pw))
print("AUTH_SECRET=" + secrets.token_urlsafe(48))
