import request from 'request-promise-native'
import discord, { TextChannel } from 'discord.js'
import { configOptions, Fields, mcVersionConfig } from './types';

let client: discord.Client, config: mcVersionConfig

export default (_client: discord.Client, _config: configOptions) => {
  client = _client
  config = _config['minecraft-version']
  if (!config) return
  if (config.webhook || config.channels) {
    const state = {}
    setInterval(poll.bind(state), (config.interval || 10) * 1000)
  }
}

async function poll (this: any) {
  try {
    const data = await request('https://launchermeta.mojang.com/mc/game/version_manifest.json', { json: true })
    const latestDate = data.versions.map((v: { time: string; }) => Date.parse(v.time)).reduce((a: number, b: number) => a > b ? a : b)
    if (this.latestDate === undefined) {
      this.latestRelease = data.latest.release
      this.latestSnapshot = data.latest.snapshot
      this.latestDate = latestDate

      // TESTING
      // update(data.versions.find(v => v.id === data.latest.snapshot), false)
      return
    }
    if (latestDate < this.latestDate) return
    this.latestDate = latestDate
    if (this.latestRelease !== data.latest.release) {
      this.latestRelease = data.latest.release
      this.latestSnapshot = data.latest.snapshot
      update(data.versions.find((v: { id: any; }) => v.id === data.latest.release))
    } else if (this.latestSnapshot !== data.latest.snapshot) {
      this.latestSnapshot = data.latest.snapshot
      update(data.versions.find((v: { id: any; }) => v.id === data.latest.snapshot))
    }
  } catch (e) {
    console.error(e)
  }
}

const fancySize = (size: number) => {
  const mbs = size / (1024 * 1204)
  return mbs.toFixed(1) + 'MB'
}

async function update (version: { url: string; type: string; id: any; releaseTime: any; }, test?: boolean) {
  const details = await request(version.url, { json: true })
  const fields: Fields = {
    Type: version.type[0].toUpperCase() + version.type.slice(1),
    Id: version.id,
    'Version JSON': `[${version.id}.json](${version.url})`,
    Assets: `[${details.assetIndex.id}](${details.assetIndex.url})`
  }
  let embedImage, embedThumbnail
  try {
    const {url, image, subtitle} = await getArticle(version)
    if (url) {
      fields.Changelog = `[${subtitle || 'minecraft.net'}](${url})`
      if (image?.endsWith('-header.jpg')) {
        embedImage = {url: image}
      } else {
        embedThumbnail = {url: image}
      }
    }
  } catch (e) {}
  const jars = `[Server JAR](${details.downloads.server.url}) (${fancySize(details.downloads.server.size)}) - [Client JAR](${details.downloads.client.url}) (${fancySize(details.downloads.client.size)})`
  const embeds = [{
    title: `Minecraft ${getFullVersionName(version)}`,
    url: version.url,
    // @ts-ignore
    description: Object.keys(fields).map(k => `**${k}**: ${fields[k]}`).join('\n') + '\n\n' + jars,
    timestamp: version.releaseTime,
    image: embedImage,
    thumbnail: embedThumbnail
  }]
  if (test) {
    console.log(embeds)
    return
  }
  if (config.webhook) await request.post(config.webhook, {json: {embeds}})
  if (config.channels) {
    for (const id of config.channels) {
      const channel = await client.channels.fetch(id) as TextChannel
      await channel.send({embed: embeds[0]})
    }
  }
}

function getFullVersionName(version: { id: string; type: string | any[]; }) {
  const match = version.id.match(/^(\d+\.\d+(?:\.\d+)?)(-(rc|pre)(\d+)$)?/)
  switch (match![3]) {
    case 'rc': return match![1] + ' Release Candidate ' + match![4]
    case 'pre': return match![1] + ' Pre-Release ' + match![4]
  }
  return version.type[0].toUpperCase() + version.type.slice(1) + ' ' + version.id
}

async function getArticle (version: { id: string; type: string; }): Promise<{ url?: string; title?: any; subtitle?: any; image?: string; }> {
  const articles = await request('https://www.minecraft.net/content/minecraft-net/_jcr_content.articles.grid', { json: true })
  const candidates = articles.article_grid.filter((article: { default_tile: { title: any; sub_header: string | string[]; }; }) => {
    const title = article.default_tile.title
    if (!title.startsWith('Minecraft ') || title.startsWith('Minecraft Dungeons') || article.default_tile.sub_header.includes('Bedrock Beta')) return false
    if (title.includes(version.id)) return true
    if (version.type !== 'snapshot') return false
    const snapshot = version.id.match(/^(\d{2}w\d{2})([a-z])$/)
    if (snapshot) return title.includes(snapshot[1])
    const match = version.id.match(/^(\d+\.\d+(?:\.\d+)?)(-(rc|pre)(\d+)$)?/)
    if (!match) return false
    switch (match[3]) {
      case 'rc': return title.includes(match[1] + ' Release Candidate')
      case 'pre': return title.includes(match[1] + ' Pre-Release')
      default: return title.includes(version.id)
    }
  })
  const article = candidates[0]
  if (!article) return {}
  const tile = article.default_tile
  let imageURL = 'https://minecraft.net' + tile.image.imageURL
  const headerImageURL = imageURL.replace('1x1', 'header')
  if (headerImageURL !== imageURL) {
    try {
      await request.head(headerImageURL)
      imageURL = headerImageURL
    } catch (e) {}
  }
  return {url: 'https://minecraft.net' + article.article_url, title: tile.title, subtitle: tile.sub_header, image: imageURL}
}
