"""Duo Stats: compare League of Legends stats for two players who queue together.

The League client running on this Mac is the main source of games. A background
listener follows the client's event stream, saves every finished game, and reads
the S grades announced in the post-game chat. Riot's web API is an optional fallback.
"""

__version__ = "2.0"
