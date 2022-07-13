const logger = require("./logging");
const toml = require('toml');
const fs = require("fs");
const config = toml.parse(fs.readFileSync("config.toml", "utf8"));

const Discord = require('discord.js');
const {Intents} = require("discord.js");
const ChannelHandler = require("./category_handler");
const client = new Discord.Client({
  intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_VOICE_STATES]
});

client.once("ready", async () => {
  const ChannelHandler = require("./category_handler");
  const keys = Object.keys(config["categories"]);

  keys.forEach(key => {
    const categoryConfig = config["categories"][key]
    const channelHandler = new ChannelHandler(logger, client, key, categoryConfig);
    try {
      channelHandler.init()
    } catch (error) {
      this.logger.error("Error while initializing " + categoryConfig["categoryId"])
    }
  });

  await client.user.setActivity('channel events', { type: 'LISTENING' });

  logger.ok("Loaded " + keys.length + " channel configuration(s)")
});

client.once("error", error => logger.err(error));
client.login(config["general"]["token"]).finally();