import os

# Integration tests run only against a throwaway database named by TEST_DATABASE_URL (a local
# Docker Postgres or the CI service). It replaces DATABASE_URL before any app module creates
# its engine, so they can never touch the real Neon database.
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
if TEST_DATABASE_URL:
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    os.environ["RUN_WORKER"] = "false"
