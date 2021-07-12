import request from 'request-promise-native';
import discord, { PermissionResolvable, TextChannel } from 'discord.js';
import { configOptions, StreamMessage } from './types';
import ApiManager from './api';

export default class scicraft {
  client: discord.Client;
  config: configOptions;
  twitchAuth: { id: string, secret: string; };
  streamMessages: Set<StreamMessage>;
  oauthToken: string | undefined;
  oauthExpires: number;

  constructor(apiManager: ApiManager) {
    this.client = apiManager.client;
    this.config = apiManager.config;
    this.twitchAuth = { id: "", secret: "" };
    this.streamMessages = new Set<StreamMessage>();
    this.oauthToken = undefined;
    this.oauthExpires = 0;

    if (this.config['cleanup-streams']) {
      const cleanupConf = this.config['cleanup-streams'];
      const channels = cleanupConf.channels || [];
      this.client.on('message', msg => {
        if (channels.includes(msg.channel.id)) this.checkCleanup(msg);
      });
      if (cleanupConf.twitchApiClientId && cleanupConf.twitchApiClientSecret) {
        this.twitchAuth.id = cleanupConf.twitchApiClientId;
        this.twitchAuth.secret = cleanupConf.twitchApiClientSecret;
        setInterval(() =>
          this.checkStreams(cleanupConf.gracePeriod || 600).catch(e => console.error(e)),
          Number(30e3));
      }
    }
    if (this.config['media-only']) {
      const mediaOnlyConf = this.config['media-only'];
      const ignoreRoles = mediaOnlyConf['ignore-roles'] || [];
      const ignorePermissions = mediaOnlyConf['ignore-permissions'] || ['MANAGE_CHANNELS'];
      const channels = mediaOnlyConf.channels || [];
      this.client.on('message', msg => {
        if (!channels.includes(msg.channel.id) || !msg.deletable || !msg.member || /\bhttp(s)?:\/\//.test(msg.content) || msg.embeds.length || msg.attachments.size) return;
        for (const [id, role] of msg.member.roles.cache) {
          if (ignoreRoles.includes(id)) {
            console.log(`${msg.id}: ${msg.author.username} has ${role.name}, not deleting`);
            return;
          }
        }
        for (const perm of ignorePermissions) {
          if (msg.member.hasPermission(perm as PermissionResolvable)) {
            console.log(`${msg.id}: ${msg.author.username} has ${perm}, not deleting`);
            return;
          }
        }
        this.deleteAndLog(msg, 'Text message in media-only channel');
      });
    }
  }

  private checkCleanup(msg: discord.Message): void {
    if (!msg.deletable || !/\btwitch\.tv\//.test(msg.content)) return;
    const match = msg.content.match(/\b(clips\.)?twitch\.tv\/(.+?)\b/);
    if (!match || match[1]) return;
    if (match[2] === 'videos') return; // Highlights & VODs
    console.log(`Picked up message ${msg.id} linking to ${match[0]} (user ${match[2]})`);
    this.streamMessages.add({ message: msg, twitchUser: match[2] });
  };

  private async checkStreams(gracePeriod: number): Promise<void> {
    const users = [...new Set([...this.streamMessages].map(m => m.twitchUser))];
    if (!users.length) return;
    const streams = await this.getTwitchApi('streams', { first: 100, user_login: users });
    const online = streams.filter((s: { type: string; }) => s.type === 'live')
      .map((s: { user_name: string; }) => s.user_name.toLowerCase());
    for (const msg of this.streamMessages) {
      if (online.includes(msg.twitchUser.toLowerCase())) continue;
      if (Date.now() - msg.message.createdTimestamp < gracePeriod * 1000) {
        if (!msg.loggedGrace) {
          console.log(msg.message.id + ' is in grace period');
          msg.loggedGrace = true;
        }
        continue;
      }
      await this.deleteAndLog(msg.message, 'Stream offline').catch(e => {
        console.error('Could not delete message ' + msg.message.id);
        console.error(e);
      });
      this.streamMessages.delete(msg);
    }
  };

  private async deleteAndLog(msg: discord.Message, reason: string): Promise<void> {
    await msg.delete({ reason });
    if (this.config.modlog) {
      const modlog = await this.client.channels.fetch(this.config.modlog) as TextChannel;
      await modlog.send({
        embed: {
          author: {
            name: msg.author.tag,
            icon_url: msg.author.displayAvatarURL(),
          },
          description: `**Message by <@${msg.author.id}> deleted in <#${msg.channel.id}>**\n${msg.content}`,
          fields: [{
            name: 'Reason',
            value: reason,
          }],
          footer: {
            text: 'ID: ' + msg.id,
          },
          timestamp: new Date(msg.createdTimestamp),
        },
      });
    }
  };

  private async getTwitchOauthToken(): Promise<any> {
    if (this.oauthToken && Date.now() < this.oauthExpires) return this.oauthToken;
    console.log('Fetching new Twitch OAuth token');
    const { access_token, expires_in } = JSON.parse(await request({
      url: 'https://id.twitch.tv/oauth2/token',
      qs: { client_id: this.twitchAuth.id, client_secret: this.twitchAuth.secret, grant_type: 'client_credentials' },
      method: 'POST',
    }));
    this.oauthExpires = Date.now() + (expires_in - 20) * 1000;
    return this.oauthToken = access_token;
  };

  private async getTwitchApi(path: string, params: { first?: number; user_login?: any[]; after?: any; }): Promise<any[]> {
    const req = () => new Promise<any>(async resolve => {
      request({
        url: 'https://api.twitch.tv/helix/' + path,
        qs: params,
        qsStringifyOptions: { arrayFormat: 'repeat' },
        headers: {
          'Client-ID': this.twitchAuth.id,
          'Authorization': 'Bearer ' + await this.getTwitchOauthToken(),
        },
      })
        .then(v => resolve(JSON.parse(v)))
        .catch(reason => console.log(`Twitch api error: ${reason}`));
    });
    let res = await req();
    const data: any[] = res.data;
    while (res.data.length && res.pagination && res.pagination.cursor && res.pagination.cursor !== 'IA') {
      params.after = res.pagination.cursor;
      res = await req();
      data.push(...res.data);
    }
    return data;
  };

}
