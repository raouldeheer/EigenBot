import request from 'request-promise-native';
import discord, { TextChannel } from 'discord.js';
import { Fields, mcVersionConfig } from './types';
import ApiManager from './api';

type Version = {
  id: string;
  type: string;
  url: string;
  releaseTime: number;
};

export default class minecraftVersion {
  client: discord.Client;
  config: mcVersionConfig;
  pollState: any;

  constructor(apiManager: ApiManager) {
    this.client = apiManager.client;
    this.config = apiManager.config['minecraft-version'];
    if (!this.config) return;
    if (this.config.webhook || this.config.channels) {
      this.pollState = {};
      setInterval(() => { this.poll(); }, (this.config.interval || 10) * 1000);
    }
  }

  private async poll() {
    try {
      const data = await request('https://launchermeta.mojang.com/mc/game/version_manifest.json', { json: true });
      const latestDate = data.versions.map((v: { time: string; }) => Date.parse(v.time)).reduce((a: number, b: number) => a > b ? a : b);
      if (this.pollState.latestDate === undefined) {
        this.pollState.latestRelease = data.latest.release;
        this.pollState.latestSnapshot = data.latest.snapshot;
        this.pollState.latestDate = latestDate;
        return;
      }
      if (latestDate < this.pollState.latestDate) return;
      this.pollState.latestDate = latestDate;
      if (this.pollState.latestRelease !== data.latest.release) {
        this.pollState.latestRelease = data.latest.release;
        this.pollState.latestSnapshot = data.latest.snapshot;
        this.update(data.versions.find((v: { id: any; }) => v.id === data.latest.release));
      } else if (this.pollState.latestSnapshot !== data.latest.snapshot) {
        this.pollState.latestSnapshot = data.latest.snapshot;
        this.update(data.versions.find((v: { id: any; }) => v.id === data.latest.snapshot));
      }
    } catch (e) {
      console.error(e);
    }
  }

  private fancySize(size: number): string {
    return (size / 1232896).toFixed(1) + 'MB';
  }

  private async update(version: Version, test?: boolean) {
    const details = await request(version.url, { json: true });
    const fields: Fields = {
      Type: version.type[0].toUpperCase() + version.type.slice(1),
      Id: version.id,
      'Version JSON': `[${version.id}.json](${version.url})`,
      Assets: `[${details.assetIndex.id}](${details.assetIndex.url})`
    };
    let embedImage, embedThumbnail;
    try {
      const { url, image, subtitle } = await this.getArticle(version);
      if (url) {
        fields.Changelog = `[${subtitle || 'minecraft.net'}](${url})`;
        if (image?.endsWith('-header.jpg')) {
          embedImage = { url: image };
        } else {
          embedThumbnail = { url: image };
        }
      }
    } catch (e) { }
    const jars = `[Server JAR](${details.downloads.server.url}) (${this.fancySize(details.downloads.server.size)}) - [Client JAR](${details.downloads.client.url}) (${this.fancySize(details.downloads.client.size)})`;
    const embeds = [{
      title: `Minecraft ${this.getFullVersionName(version)}`,
      url: version.url,
      // @ts-ignore
      description: Object.keys(fields).map(k => `**${k}**: ${fields[k]}`).join('\n') + '\n\n' + jars,
      timestamp: version.releaseTime,
      image: embedImage,
      thumbnail: embedThumbnail
    }];
    if (test) {
      console.log(embeds);
      return;
    }
    if (this.config.webhook) await request.post(this.config.webhook, { json: { embeds } });
    if (this.config.channels) {
      for (const id of this.config.channels) {
        const channel = await this.client.channels.fetch(id) as TextChannel;
        await channel.send({ embed: embeds[0] });
      }
    }
  }

  private getFullVersionName(version: Version) {
    const match = version.id.match(/^(\d+\.\d+(?:\.\d+)?)(-(rc|pre)(\d+)$)?/);
    switch (match![3]) {
      case 'rc': return match![1] + ' Release Candidate ' + match![4];
      case 'pre': return match![1] + ' Pre-Release ' + match![4];
    }
    return version.type[0].toUpperCase() + version.type.slice(1) + ' ' + version.id;
  }

  private async getArticle(version: Version): Promise<{ url?: string; title?: any; subtitle?: any; image?: string; }> {
    const articles = await request('https://www.minecraft.net/content/minecraft-net/_jcr_content.articles.grid', { json: true });
    const candidates = articles.article_grid.filter((article: { default_tile: { title: string; sub_header: string | string[]; }; }) => {
      const title = article.default_tile.title;
      if (!title.startsWith('Minecraft ') || title.startsWith('Minecraft Dungeons') || article.default_tile.sub_header.includes('Bedrock Beta')) return false;
      if (title.includes(version.id)) return true;
      if (version.type !== 'snapshot') return false;
      const snapshot = version.id.match(/^(\d{2}w\d{2})([a-z])$/);
      if (snapshot) return title.includes(snapshot[1]);
      const match = version.id.match(/^(\d+\.\d+(?:\.\d+)?)(-(rc|pre)(\d+)$)?/);
      if (!match) return false;
      switch (match[3]) {
        case 'rc': return title.includes(match[1] + ' Release Candidate');
        case 'pre': return title.includes(match[1] + ' Pre-Release');
        default: return title.includes(version.id);
      }
    });
    const article = candidates[0];
    if (!article) return {};
    const tile = article.default_tile;
    let imageURL = 'https://minecraft.net' + tile.image.imageURL;
    const headerImageURL = imageURL.replace('1x1', 'header');
    if (headerImageURL !== imageURL) {
      try {
        await request.head(headerImageURL);
        imageURL = headerImageURL;
      } catch (e) { }
    }
    return { url: 'https://minecraft.net' + article.article_url, title: tile.title, subtitle: tile.sub_header, image: imageURL };
  }

}
