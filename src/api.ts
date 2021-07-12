import JiraApi from 'jira-client';
import discord from 'discord.js';
import { configOptions } from './types';
import 'mylas';

export default class ApiManager {
    config: configOptions;
    client: discord.Client;
    jira: JiraApi;

    constructor(path: string, modules: any[]) {
        // Load config
        this.config = JSON.loadS<configOptions>(path);

        // Setup discord bot
        this.client = new discord.Client();
        this.client.on('ready', () => {

            console.log(`Logged in as ${this.client.user!.tag}!`);
            // Set the presence for the bot (Listening to !help)

            this.client.user!.setPresence({
                status: 'online',
                activity: {
                    name: this.config.prefix + 'help',
                    type: 2,
                },
            });
        });

        // Setup jira
        this.jira = new JiraApi({
            protocol: 'https',
            host: this.config.host,
            port: '443',
            username: this.config.user,
            password: this.config.password,
            apiVersion: '2',
            strictSSL: true,
        });

        // Load modules
        modules.forEach(module => new module(this));
    }

    public start() {
        // Login to discord
        this.client.login(this.config.token);
    }

}
