const logger = require("./logging");
const toml = require('toml');
const fs = require("fs");
const config = toml.parse(fs.readFileSync("config.toml", "utf8"));

const Discord = require('discord.js');
const client = new Discord.Client();

client.once("ready", async () => {
  const ChannelHandler = require("./category_handler");
  const keys = Object.keys(config["categories"]);

  keys.forEach(key => {
    new ChannelHandler(logger, client, key, config["categories"][key]);
  });

  await client.user.setActivity('channel events', { type: 'LISTENING' });

  logger.ok("Loaded " + keys.length + " channel configuration(s)")
});

client.once("error", error => logger.err(error));
client.login(config["general"]["token"]).finally();