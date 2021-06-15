import discord from 'discord.js'

export interface configOptions {
  "token": string                     // default: "" //This is the bot token
  "host": string                      // default: "bugs.mojang.com" //You shouldn't need to change this
  "user": string                      // default: "" //This is your JIRA username
  "password": string                  // default: "" //Password for the same account
  "prefix": string                    // default: "!" //Prefix for bot commands
  "url": string                       // default: "https://github.com/skyrising/SciCraftBot" //Linked to in !help
  "name": string                      // default: "SciCraft Bot" //Bot name listed in !help
  "colors": {                         //Colors for JIRA issue statuses
      "Open": number                  // default: 4876165
      "Resolved": number              // default: 1345836
      "In Progress": number           // default: 16765777 //Unused, but we can leave that in there
      "Reopened": number              // default:  4876165
      "Closed": number                // default:  1345836
      "Postponed": number             // default:  16765777
      "Invalid": number               // default:  9441545 //For Invalid, Duplicate, Incomplete, and Cannot Reproduce resolutions
      "Working": number               // default:  16777215 //For Won't Fix and Works as Intended resolutions
  },
  "modlog": string                    // default:  "" // channel id where to log deletions
  "cleanup-streams": {
    "twitchApiClientId": string       // default:  "" // Twitch API client id (required to check which streams are live)
    "twitchApiClientSecret": string   // default:  ""
    "channels": string[]              // default:  [""] // List of channels where stream links should be moderated
    "gracePeriod": number             // default:  600 // Amount of time messages are allowed to stay before streams go online (seconds)
  },
  "media-only": {
    "ignore-roles": string[]          // default:  ["<role-id>"] // Roles that are allowed to post text messages
    "ignore-permissions": string[]    // default:  ["<permission>"] // Users with one of these permissions are allowed as well, default is ["MANAGE_CHANNELS"]
    "channels": string[]              // default:  ["<channel-id>"] // Channels which are moderated for messages that require media attachments or links
  },
  "minecraft-version": mcVersionConfig
}

export interface mcVersionConfig {
  "channels": string[]              // default:  ["<channel-id>"],
  "webhook": string                 // default:  "<url>"
  "interval": number
}

export interface StreamMessage {
  message: discord.Message,
  twitchUser: string,
  loggedGrace?: boolean
}

export interface Fields {
  Changelog?: string;
  Type: string;
  Id: any;
  'Version JSON': string;
  Assets: string;
}