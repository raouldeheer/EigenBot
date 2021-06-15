import fs from 'fs'
import JiraApi from 'jira-client'
import discord from 'discord.js'

const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'))
const client = new discord.Client()

client.on('ready', () => {
  
  console.log(`Logged in as ${client.user!.tag}!`)
  // Set the presence for the bot (Listening to !help)

  client.user!.setPresence({
    status: 'online',
    activity: {
      name: config.prefix + 'help',
      type: 2
    }
  })
})

const jira = new JiraApi({
  protocol: 'https',
  host: config.host,
  port: '443',
  username: config.user,
  password: config.password,
  apiVersion: '2',
  strictSSL: true
})

for (const module of ['eigenbot', 'scicraft', 'minecraft-version']) {
  import('./' + module + '.js').then(m => m.default(client, config, jira))
}

// Login with token
client.login(config.token)