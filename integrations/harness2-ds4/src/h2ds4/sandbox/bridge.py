"""Loopback TCP -> Unix socket bridge, run INSIDE the network-less sandbox (plan §16.3).

Standalone stdlib script: `python3 bridge.py <port> <unix_socket_path> <ready_file>`.
It can only reach the one bind-mounted socket; the sandbox has no other network.
"""

import asyncio
import sys


async def _pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except (ConnectionError, asyncio.IncompleteReadError):
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


async def _main(port: int, uds: str, ready: str) -> None:
    async def handle(cr: asyncio.StreamReader, cw: asyncio.StreamWriter) -> None:
        try:
            ur, uw = await asyncio.open_unix_connection(uds)
        except OSError:
            cw.close()
            return
        await asyncio.gather(_pipe(cr, uw), _pipe(ur, cw))

    server = await asyncio.start_server(handle, '127.0.0.1', port)
    with open(ready, 'w') as f:
        f.write('ready\n')
    async with server:
        await server.serve_forever()


if __name__ == '__main__':
    asyncio.run(_main(int(sys.argv[1]), sys.argv[2], sys.argv[3]))
