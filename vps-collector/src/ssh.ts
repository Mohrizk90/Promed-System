import { Client } from 'ssh2';
import { config } from './config.js';
import { logger } from './logger.js';

export interface SshOptions {
  /** SSH config alias or hostname; defaults to config.sshHost ("smops"). */
  host?: string;
  username?: string;
  /** Connection timeout in ms. */
  readyTimeout?: number;
}

/**
 * Thin promise-based wrapper around ssh2.Client. Resolves host/username from
 * the user's `~/.ssh/config` automatically when `host` is an alias like
 * "smops". A single SSH client is reused across commands on the same tick
 * to amortize handshake cost.
 */
export class Ssh {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;
  private closed = false;

  constructor(
    private readonly opts: SshOptions = {},
    private readonly log = logger,
  ) {}

  async run(cmd: string, timeoutMs = 30_000): Promise<string> {
    const client = await this.getClient();
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`ssh run timeout after ${timeoutMs}ms: ${cmd.slice(0, 80)}`));
      }, timeoutMs);

      client.exec(cmd, (err, channel) => {
        if (err) {
          clearTimeout(timer);
          reject(err);
          return;
        }
        let stdout = '';
        let stderr = '';
        channel.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8');
        });
        channel.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8');
        });
        channel.on('close', (code: number | null) => {
          clearTimeout(timer);
          if (code !== 0) {
            reject(
              new Error(
                `ssh command exited ${code}: ${cmd.slice(0, 80)}\nstderr: ${stderr.slice(0, 500)}`,
              ),
            );
            return;
          }
          resolve(stdout);
        });
        channel.on('error', (e: Error) => {
          clearTimeout(timer);
          reject(e);
        });
      });
    });
  }

  /** Open or reuse a connection. */
  async connect(): Promise<Client> {
    return this.getClient();
  }

  async ping(): Promise<boolean> {
    try {
      const out = await this.run('echo ok', 5_000);
      return out.trim() === 'ok';
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.client) {
      try {
        this.client.end();
      } catch (e) {
        this.log.warn({ err: (e as Error).message }, 'ssh close error');
      }
      this.client = null;
    }
  }

  private getClient(): Promise<Client> {
    if (this.client) return Promise.resolve(this.client);
    if (this.connecting) return this.connecting;
    this.connecting = this.open().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private open(): Promise<Client> {
    return new Promise<Client>((resolve, reject) => {
      const client = new Client();
      const host = this.opts.host ?? config.sshHost;
      const username = this.opts.username ?? config.sshUser;

      client.on('ready', () => {
        this.log.info({ host, username }, 'ssh ready');
        this.client = client;
        resolve(client);
      });
      client.on('error', (err) => {
        this.log.warn({ host, err: err.message }, 'ssh error');
        this.client = null;
        if (this.connecting) reject(err);
      });
      client.on('close', () => {
        this.log.debug('ssh connection closed');
        this.client = null;
      });

      client.connect({
        host,
        username,
        readyTimeout: this.opts.readyTimeout ?? 15_000,
        keepaliveInterval: 10_000,
        keepaliveCountMax: 3,
      });

      if (this.closed) {
        client.end();
      }
    });
  }
}
