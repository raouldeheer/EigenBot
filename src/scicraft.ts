import request from 'request-promise-native';
import discord, { TextChannel } from 'discord.js';
import { StreamMessage } from './types';

let client: discord.Client, config: any;
const twitchAuth = { id: null, secret: null };
const streamMessages = new Set<StreamMessage>();
let oauthToken: any;
let oauthExpires: number;

export default (_client: discord.Client, _config: any) => {
  client = _client;
  config = _config;
  if (config['cleanup-streams']) {
    const cleanupConf = config['cleanup-streams'];
    const channels = cleanupConf.channels || [];
    client.on('message', msg => {
      if (channels.includes(msg.channel.id)) checkCleanup(msg);
    });
    if (cleanupConf.twitchApiClientId && cleanupConf.twitchApiClientSecret) {
      twitchAuth.id = cleanupConf.twitchApiClientId;
      twitchAuth.secret = cleanupConf.twitchApiClientSecret;
      setInterval(() =>
        checkStreams(cleanupConf.gracePeriod || 600).catch(e => console.error(e)),
        Number(30e3));
    }
  }
  if (config['media-only']) {
    const mediaOnlyConf = config['media-only'];
    const ignoreRoles = mediaOnlyConf['ignore-roles'] || [];
    const ignorePermissions = mediaOnlyConf['ignore-permissions'] || ['MANAGE_CHANNELS'];
    const channels = mediaOnlyConf.channels || [];
    client.on('message', msg => {
      if (!channels.includes(msg.channel.id) || !msg.deletable || !msg.member || /\bhttp(s)?:\/\//.test(msg.content) || msg.embeds.length || msg.attachments.size) return;
      for (const [id, role] of msg.member.roles.cache) {
        if (ignoreRoles.includes(id)) {
          console.log(`${msg.id}: ${msg.author.username} has ${role.name}, not deleting`);
          return;
        }
      }
      for (const perm of ignorePermissions) {
        if (msg.member.hasPermission(perm)) {
          console.log(`${msg.id}: ${msg.author.username} has ${perm}, not deleting`);
          return;
        }
      }
      deleteAndLog(msg, 'Text message in media-only channel');
    });
  }
};

const checkCleanup = (msg: discord.Message): void => {
  if (!msg.deletable || !/\btwitch\.tv\//.test(msg.content)) return;
  const match = msg.content.match(/\b(clips\.)?twitch\.tv\/(.+?)\b/);
  if (!match || match[1]) return;
  if (match[2] === 'videos') return; // Highlights & VODs
  console.log(`Picked up message ${msg.id} linking to ${match[0]} (user ${match[2]})`);
  streamMessages.add({ message: msg, twitchUser: match[2] });
};

const checkStreams = async (gracePeriod: number): Promise<void> => {
  const users = [...new Set([...streamMessages].map(m => m.twitchUser))];
  if (!users.length) return;
  const streams = await getTwitchApi('streams', { first: 100, user_login: users });
  const online = streams.filter((s: { type: string; }) => s.type === 'live')
    .map((s: { user_name: string; }) => s.user_name.toLowerCase());
  for (const msg of streamMessages) {
    if (online.includes(msg.twitchUser.toLowerCase())) continue;
    if (Date.now() - msg.message.createdTimestamp < gracePeriod * 1000) {
      if (!msg.loggedGrace) {
        console.log(msg.message.id + ' is in grace period');
        msg.loggedGrace = true;
      }
      continue;
    }
    await deleteAndLog(msg.message, 'Stream offline').catch(e => {
      console.error('Could not delete message ' + msg.message.id);
      console.error(e);
    });
    streamMessages.delete(msg);
  }
};

const deleteAndLog = async (msg: discord.Message, reason: string): Promise<void> => {
  await msg.delete({ reason });
  if (config.modlog) {
    const modlog = await client.channels.fetch(config.modlog) as TextChannel;
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

const getTwitchOauthToken = async (): Promise<any> => {
  if (oauthToken && Date.now() < oauthExpires) return oauthToken;
  console.log('Fetching new Twitch OAuth token');
  const { access_token, expires_in } = JSON.parse(await request({
    url: 'https://id.twitch.tv/oauth2/token',
    qs: { client_id: twitchAuth.id, client_secret: twitchAuth.secret, grant_type: 'client_credentials' },
    method: 'POST',
  }));
  oauthToken = access_token;
  oauthExpires = Date.now() + (expires_in - 20) * 1000;
  return oauthToken;
};

const getTwitchApi = async(path: string, params: { first?: number; user_login?: any[]; after?: any; }): Promise<any> => {
  const token = await getTwitchOauthToken();
  const req = () => request({
    url: 'https://api.twitch.tv/helix/' + path,
    qs: params,
    qsStringifyOptions: { arrayFormat: 'repeat' },
    headers: {
      'Client-ID': twitchAuth.id,
      'Authorization': 'Bearer ' + token,
    },
  });
  let res = JSON.parse(await req());
  const data = res.data;
  while (res.data.length && res.pagination && res.pagination.cursor && res.pagination.cursor !== 'IA') {
    params.after = res.pagination.cursor;
    res = JSON.parse(await req());
    data.push(...res.data);
  }
  return data;
}
