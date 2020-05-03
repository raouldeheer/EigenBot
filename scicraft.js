const request = require('request-promise-native')

let client, config
const streamMessages = new Set()

module.exports = (_client, _config) => {
  client = _client
  config = _config
  if (config['cleanup-streams']) {
    const cleanupConf = config['cleanup-streams']
    const channels = cleanupConf.channels || []
    client.on('message', msg => {
      if (channels.includes(msg.channel.id)) checkCleanup(msg)
    })
    if (cleanupConf.twitchApiClientId) {
      setInterval(async () => {
        try {
          await checkStreams(cleanupConf.twitchApiClientId, cleanupConf.gracePeriod || (10 * 60))
        } catch (e) {
          console.error(e)
        }
      }, 30e3)
    }
  }
}

function checkCleanup(msg) {
  if (!msg.deletable || !/twitch\.tv\//.test(msg.content)) return
  const match = msg.content.match(/twitch\.tv\/(.+)\b/)
  if (!match) return
  console.log('Picked up message ' + msg.id + ' linking to ' + match[0])
  streamMessages.add({
    message: msg,
    twitchUser: match[1]
  })
}

async function checkStreams(clientId, gracePeriod) {
  const users = [...new Set([...streamMessages].map(m => m.twitchUser))]
  if (!users.length) return
  const streams = await getTwitchApi('streams', clientId, {first: 100, user_login: users})
  const online = streams.filter(s => s.type === 'live').map(s => s.user_name.toLowerCase())
  for (const msg of streamMessages) {
    if (online.includes(msg.twitchUser.toLowerCase())) continue
    if (Date.now() - msg.message.createdTimestamp < gracePeriod * 1000) {
      if (!msg.loggedGrace) {
        console.log(msg.message.id + ' is in grace period')
        msg.loggedGrace = true
      }
      continue
    }
    try {
      await deleteAndLog(msg.message, 'Stream offline')
    } catch (e) {
      console.error('Could not delete message ' + msg.message.id)
      console.error(e)
    }
    streamMessages.delete(msg)
  }
}

async function deleteAndLog(msg, reason) {
  await msg.delete({reason})
  if (config.modlog) {
    const modlog = await client.channels.fetch(config.modlog)
    await modlog.send({
      embed: {
        author: {
          name: msg.author.tag,
          icon_url: msg.author.displayAvatarURL()
        },
        description: `**Message by <@${msg.author.id}> deleted in <#${msg.channel.id}>**\n${msg.content}`,
        fields: [{
          name: 'Reason',
          value: reason
        }],
        footer: {
          text: 'ID: ' + msg.id
        },
        timestamp: new Date(msg.createdTimestamp)
      }
    })
  }
}

async function getTwitchApi (path, clientId, params) {
  const r = () => request({
    url: 'https://api.twitch.tv/helix/' + path, qs: params, qsStringifyOptions: {arrayFormat: 'repeat'},
    headers: {
      'Client-ID': clientId
    }
  })
  let res = JSON.parse(await r())
  const data = res.data
  while (res.data.length && res.pagination && res.pagination.cursor && res.pagination.cursor !== 'IA') {
    params.after = res.pagination.cursor
    res = JSON.parse(await r())
    data.push(...res.data)
  }
  return data
}
