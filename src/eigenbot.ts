import request from 'request';
import discord from 'discord.js';
import JiraApi from 'jira-client';
import { configOptions } from './types';
import ApiManager from './api';

export default class Eigenbot {
  jira: JiraApi;
  client: discord.Client;
  config: configOptions;
  helpMessage: any;

  constructor(apiManager: ApiManager) {
    this.jira = apiManager.jira;
    this.client = apiManager.client;
    this.config = apiManager.config;

    // setup onMessage event
    this.client.on('message', msg => this.onMessage(msg));

    // setup help message
    this.helpMessage = {
      embed: {
        title: this.config.prefix + 'help',
        description: 'I listen for Minecraft bug report links or ' + this.config.prefix + 'PROJECT-NUMBER\n' +
          'For example, saying https://bugs.mojang.com/browse/MC-81098 or ' + this.config.prefix + 'MC-81098 will give quick info on those bugs',
        fields: [
          {
            name: 'Other commands: ',
            value: '**' + this.config.prefix + 'help:** Shows this help screen.\n' +
              '**' + this.config.prefix + 'mcstatus:** Checks Mojang server status.'
          }
        ],
        url: this.config.url,
        color: 9441545,
        footer: {
          text: this.config.name
        }
      }
    };
  }

  private onMessage(msg: discord.Message) {
    const escapedPrefix = this.config.prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regexPattern = new RegExp(escapedPrefix + '(mc|mcapi|mcce|mcds|mcl|mcpe|realms|sc|web)-[0-9]{1,7}', 'gi');
    const urlRegex = /https?:\/\/bugs.mojang.com\/browse\/(mc|mcapi|mcce|mcds|mcl|mcpe|realms|sc|web)-[0-9]{1,7}/gi;
    // We don't want our bot to react to other bots or itself
    if (msg.author.bot) return;

    // help: Gives usage information
    if (msg.content.startsWith(this.config.prefix + 'help')) {
      msg.channel.send(this.helpMessage);
      return;
    }

    // upcoming: Checks for fixes in unreleased snapshots
    if (msg.content.startsWith(this.config.prefix + 'upcoming')) {
      this.sendUpcoming(msg);
      return;
    }

    // mcstatus: Checks Mojang server status
    if (msg.content.startsWith(this.config.prefix + 'mcstatus')) {
      this.sendStatus(msg.channel);
      return;
    }
    let matches: string[] = [];
    // Check for prefixed issue keys (!MC-1)
    const piks = msg.content.match(regexPattern);
    if (piks) matches = piks.map(prefixedIssueKey => prefixedIssueKey.slice(this.config.prefix.length));
    // Check for bugs.mojang.com urls
    const urls = msg.content.match(urlRegex);
    if (urls) {
      matches = matches.concat(urls.map(function (url) {
        return url.split('/')[4];
      }));
    }
    matches = matches.filter((elem, index, self) => self.indexOf(elem) === index);
    if (matches.length) {
      // Get a list of issues by issue key
      matches.forEach((issueKey) => {
        this.jira.findIssue(issueKey).then(issue => {
          // Send info about the bug in the form of an embed to the Discord channel
          this.sendEmbed(msg.channel, issue);
        }).catch(error => {
          if (error && error.error && error.error.errorMessages && error.error.errorMessages.includes('Issue Does Not Exist')) {
            msg.channel.send('No issue was found for ' + issueKey + '.');
          } else {
            msg.channel.send('An unknown error has occurred.');
            console.log(error);
          }
        });
      });
    }
  }

  private sendUpcoming(msg: discord.Message) {
    let project = 'MC';

    const args = msg.content.split(' ');
    if (args.length > 1) {
      const projects = /^(mc|mcapi|mcce|mcds|mcl|mcpe|realms|sc|web)$/gi;
      if (projects.test(args[1])) {
        project = args[1].toUpperCase();
      } else {
        msg.channel.send('Invalid project ID.');
      }
    }

    let done = false;
    this.jira.searchJira('project = ' + project + ' AND fixVersion in unreleasedVersions() ORDER BY resolved DESC')
      .then(results => {
        if (!results.issues || !results.issues.length) {
          msg.channel.send('No upcoming bugfixes were found.');
          done = true;
          return;
        }

        function addLine(issues: Iterator<any>, response: string) {
          // Get the next issue, if it exists
          const iter = issues.next();
          if (iter.done) {
            // Otherwise, send the final message
            msg.channel.send(response).catch((error) => {
              console.log(error);
              msg.channel.send('An error has occurred.');
            });
            done = true;
            return;
          }

          // Add the key and title for each bug
          const line = '**' + iter.value.key + '**: *' + iter.value.fields.summary + '*\n';

          // If this line would make the message too long, split into multiple messages
          if (response.length + line.length >= 2000) {
            msg.channel.send(response).then(() => {
              addLine(issues, line);
            }).catch((error) => {
              console.log(error);
              msg.channel.send('An error has occurred.');
            });
          } else {
            addLine(issues, response + line);
          }
        }

        addLine(results.issues[Symbol.iterator](), 'The following bugs will likely be fixed in the next snapshot: \n');
        done = true;
      }).catch(error => {
        msg.channel.send('An error has occurred.');
        console.log('Error when processing upcoming command:');
        console.log(error);
        done = true;
      });

    setTimeout(() => {
      if (!done) msg.channel.send('Searching for upcoming bugfixes, please wait...');
    }, 500);
  }

  private sendStatus(channel: discord.TextChannel | discord.DMChannel | discord.NewsChannel) {
    // Request json object with the status of services
    request('https://status.mojang.com/check', (error, _response, body) => {
      // We really should never get this. If you are getting this, please verify that Mojang still exists.
      if (error) {
        channel.send("Unable to reach Mojang API for status check. Let's assume everything went wrong.");
        return;
      }
      // Gives a list of objects with a single key-value pair consisting of the service name as the key and status as a color green, yellow, or red as the value
      if (JSON.parse(body).every((service: any) => {
        // Get service name
        const name = Object.keys(service)[0];
        if (service[name] !== 'green') channel.send('Service ' + name + ' has status ' + service[name]);
        return service[name] !== 'green';
      })) {
        // Run only
        channel.send('All services are working normally.');
      }
    });
  }

  // Send info about the bug in the form of an embed to the Discord channel
  private sendEmbed(channel: discord.TextChannel | discord.DMChannel | discord.NewsChannel, issue: JiraApi.JsonResponse) {
    // Generate the message
    // Pick a color based on the status
    // @ts-ignore
    let color: number = config.colors[issue.fields.status.name];
    // Additional colors for different resolutions
    if (issue.fields.resolution && ['Invalid', 'Duplicate', 'Incomplete', 'Cannot Reproduce'].includes(issue.fields.resolution.name)) {
      color = this.config.colors['Invalid'];
    } else if (issue.fields.resolution && ["Won't Fix", 'Works As Intended'].includes(issue.fields.resolution.name)) {
      color = this.config.colors['Working'];
    }
    // Create the embed
    channel.send({
      embed: {
        title: issue.key + ': ' + issue.fields.summary,
        url: 'https://bugs.mojang.com/browse/' + issue.key,
        description: ('**Status:** ' + issue.fields.status.name +
          (!issue.fields.resolution ?
            ' | **Votes:** ' + issue.fields.votes.votes :
            ' | **Resolution:** ' + issue.fields.resolution.name)),
        color: color,
        timestamp: new Date(Date.parse(issue.fields.created)),
        footer: {
          text: 'Created'
        }
      }
    });
  }

}
