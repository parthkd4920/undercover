"""Run the browser tests against disposable pilot records, without model calls."""

import os
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory

import uvicorn

from backend import database, seed


def main():
    """Seed deterministic claim states and serve only the isolated test database."""
    with TemporaryDirectory(prefix="undercover-e2e-") as directory:
        os.environ["UNDERCOVER_DB"] = str(Path(directory) / "claims.db")
        with closing(database.connect()) as connection:
            seed.seed(connection)
            connection.execute(
                "UPDATE claims SET status = 'in_progress' WHERE claim_id = 'CLM-1004'"
            )
            connection.commit()
        uvicorn.run("backend.main:app", host="127.0.0.1", port=18000)


if __name__ == "__main__":
    main()
