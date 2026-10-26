"""Errors the app reports to the page as friendly messages."""


class DuoStatsError(Exception):
    """Something the person can fix (wrong key, League closed, unknown Riot ID...)."""


class RiotApiError(DuoStatsError):
    pass


class ClientUnavailable(DuoStatsError):
    def __init__(self, message="Couldn't find the League client. Open League, log in, and try again."):
        super().__init__(message)


class ClientRequestError(DuoStatsError):
    """The client is running but refused a request (e.g. 404 for something it doesn't have)."""

    def __init__(self, path, status):
        self.path, self.status = path, status
        super().__init__(f"The League client returned an error ({status}) for {path.split('?')[0]}.")
