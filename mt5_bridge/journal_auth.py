"""
Supabase connection for the bridge scripts.

── Why this exists ────────────────────────────────────────────────────────────
The bridge originally connected with the SERVICE key, which bypasses Row Level
Security entirely. That is fine when the only person running it owns the
database. It stops being fine the moment a second person runs it: the service
key can read and modify *every* user's trades, so handing it to each user makes
every user an administrator of everyone else's journal.

So the preferred path is to sign in as the user with their journal email and
password, using the public anon key. Supabase then issues a JWT scoped to that
account, and RLS confines every read and write to their own rows — the same
protection the web app relies on.

The service key still works, because a single-user self-hosted setup is a
legitimate way to run this, but it announces itself loudly.
"""

import os
import sys

from supabase import create_client


def connect(quiet=False):
    """Return (client, user_id).

    Prefers user credentials; falls back to the service key with a warning.
    Exits with a readable message rather than a traceback when neither is
    configured.
    """
    url = os.environ.get("SUPABASE_URL")
    anon = os.environ.get("SUPABASE_ANON_KEY")
    email = os.environ.get("JOURNAL_EMAIL")
    password = os.environ.get("JOURNAL_PASSWORD")
    service = os.environ.get("SUPABASE_SERVICE_KEY")
    explicit_user = os.environ.get("JOURNAL_USER_ID")

    if not url:
        fail("SUPABASE_URL is not set. Copy .env.example to .env and fill it in.")

    if anon and email and password:
        sb = create_client(url, anon)
        try:
            session = sb.auth.sign_in_with_password({"email": email, "password": password})
        except Exception as e:
            fail(f"Could not sign in to the journal as {email}: {e}")

        user = getattr(session, "user", None)
        if not user or not getattr(user, "id", None):
            fail("Signed in but got no user back — check JOURNAL_EMAIL / JOURNAL_PASSWORD.")

        if not quiet:
            print(f"Signed in to the journal as {email} (row-level security applies)")
        return sb, user.id

    if service:
        if not explicit_user:
            fail("JOURNAL_USER_ID is required when using the service key.\n"
                 "Better: set SUPABASE_ANON_KEY, JOURNAL_EMAIL and JOURNAL_PASSWORD instead —\n"
                 "the user id then comes from the login and RLS applies.")
        if not quiet:
            print("WARNING: connecting with the SERVICE key, which bypasses row-level security.")
            print("  Fine if you're the only person using this database. If anyone else runs")
            print("  this bridge, give them SUPABASE_ANON_KEY + JOURNAL_EMAIL + JOURNAL_PASSWORD")
            print("  instead — a service key lets its holder read every user's trades.")
        return create_client(url, service), explicit_user

    fail("No journal credentials configured.\n"
         "Set SUPABASE_ANON_KEY, JOURNAL_EMAIL and JOURNAL_PASSWORD in .env (recommended),\n"
         "or SUPABASE_SERVICE_KEY and JOURNAL_USER_ID for a single-user setup.")


def fail(message):
    print(message)
    sys.exit(1)
