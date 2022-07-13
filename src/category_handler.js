const {clearArray} = require("./util")
const {Mutex, withTimeout} = require("async-mutex")
const {Permissions} = require("discord.js");

class CategoryHandler {
  constructor(baseLogger, client, handlerId, categoryConfig) {
    this.logger = baseLogger.childLogger(`channelHandler:${handlerId}`);
    this.client = client;
    this.categoryConfig = categoryConfig;
    this.channelMutexes = [];
  }

  async init() {
    this.category = await this.client.channels.fetch(this.categoryConfig["categoryId"]);
    this.client.on('voiceStateUpdate', this.handleVoiceStateUpdate.bind(this));

    if (this.categoryConfig["autoText"]) {
      this.logger.ok(`Performing initial text channel update for category ${this.category.name}`)
      await Promise.all(this.getAllVoiceChannels(this.category.id).map(channel => {
        return this.updateTextChannels(null, channel, null);
      }));
    }

    if (this.categoryConfig["autoVoice"]) {
      this.logger.ok(`Performing initial voice channel update for category ${this.category.name}`)
      await this.updateVoiceChannels(true);
    }

    this.logger.ok(`Initialized category ${this.category.name}`)
  }

  getChannelMutex(channelId) {
    const mutexKey = "new:" + channelId;
    if (this.channelMutexes[mutexKey] == null) {
      this.channelMutexes[mutexKey] = withTimeout(new Mutex(), 30_000,
        new Error("Mutex for channel " + channelId + " timed out"))
    }
    return this.channelMutexes[mutexKey];
  }

  async handleVoiceStateUpdate(oldState, newState) {
    if (oldState.channelId === newState.channelId) return; // Ignore Mute / Unmute

    await this.getChannelMutex(newState.channelId).runExclusive(async () => {
      try {
        await Promise.all([
          this.updateTextChannels(
            oldState.channelId == null ? null : await this.client.channels.fetch(oldState.channelId),
            newState.channelId == null ? null : await this.client.channels.fetch(newState.channelId),
            await newState.guild.members.fetch(newState.id)
          ),
          this.updateVoiceChannels()
        ])
      } catch (e) {
        this.logger.err(e);
      }
    })
  }

  async updateTextChannels(oldVoiceChannel, newVoiceChannel, member) {
    if (!this.categoryConfig["autoText"]) return;

    await Promise.all([
      this.updateTextChannel(newVoiceChannel, member, true)
        .catch(e => this.logger.err(`Failed to update old text channel for ${oldVoiceChannel?.name}`, e)),
      this.updateTextChannel(oldVoiceChannel, member, false)
        .catch(e => this.logger.err(`Failed to update new text channel for ${newVoiceChannel?.name}`, e))
    ])
  }

  async updateTextChannel(voiceChannel, member, canSee) {
    if (voiceChannel == null) return;
    if (voiceChannel.parentId !== this.category.id) return;

    const textChannel = await this.updateTextChannelExistence(voiceChannel);
    if (textChannel == null) return;

    if (member != null) {
      await this.updateTextChannelPermissions(member, voiceChannel, textChannel, canSee);
    } else {
      await Promise.all(voiceChannel.members.map(channelMember => {
        return this.updateTextChannelPermissions(channelMember, voiceChannel, textChannel, canSee)
      }));
    }
  }

  async updateTextChannelExistence(voiceChannel) {
    const textChannelName = this.getTextChannelName(voiceChannel);
    const textChannels = this.getChannels(this.category.id, "GUILD_TEXT", textChannelName);

    if (textChannels.length === 0 && voiceChannel.members.size > 0) {
      const channelProps = {
        parent: this.category,
        type: "GUILD_TEXT",
        permissionOverwrites: [
          {id: this.category.guild.roles.everyone.id, deny: ['VIEW_CHANNEL']},
          {id: this.client.user.id, allow: ['VIEW_CHANNEL']}
        ],
      };

      if (this.categoryConfig["autoTextPosition"] === "top") {
        channelProps.position = 0;
      }

      const newChannel = await this.category.guild.channels.create(textChannelName, channelProps)

      textChannels.push(newChannel)

      this.logger.ok(`Created text channel ${newChannel.name}`);
    } else if (textChannels.length > 0 && voiceChannel.members.size === 0) {
      for (let textChannel of textChannels) {
        await textChannel.delete();
        this.logger.ok(`Deleted text channel ${textChannel.name}`);
      }

      clearArray(textChannels)
    }

    return textChannels[0];
  }

  async updateTextChannelPermissions(member, voiceChannel, textChannel, canSee) {
    const memberPermissions = member.permissionsIn(textChannel);
    if (memberPermissions.has(Permissions.FLAGS.ADMINISTRATOR)) return; // Administrators can always see the channel

    const hasAccess = memberPermissions.has(Permissions.FLAGS.VIEW_CHANNEL);
    this.logger.ok("checking permissions for " + member.displayName + " shallSee=" + canSee + " hasAccess=" + hasAccess)
    if (canSee === hasAccess) return;

    await textChannel.permissionOverwrites.edit(member, {"VIEW_CHANNEL": canSee})
  }

  getTextChannelName(voiceChannel) {
    return `${this.categoryConfig["autoTextPrefix"]}-${voiceChannel.name.toLowerCase().split(" ").join("-")}`;
  }

  async updateVoiceChannels(initial = false) {
    if (!this.categoryConfig["autoVoice"]) return;

    const category = await this.client.channels.fetch(this.categoryConfig["categoryId"]);
    const voiceChannels = this.getAutoVoiceChannels(category.id);

    if (initial && voiceChannels.every(channel => channel.members.size < 1)) {
      await Promise.all(voiceChannels.map(channel => channel.delete()))
      clearArray(voiceChannels)
      this.logger.ok(`Reset voice channels in category ${this.category.name}`)
    }

    // Find empty channels at the end
    let emptyAtTail = voiceChannels.reduce((total, voiceChannel) => voiceChannel.members.size > 0 ? 0 : total + 1, 0);
    if (emptyAtTail === 0 && voiceChannels.length < this.categoryConfig["autoVoiceChannelLimit"]) {
      await this.createVoiceChannel(category, voiceChannels.length + 1)
      return;
    }

    // Delete empty channels at tail. Not necessary if a new channel was just created
    const deletionPromises = [];
    while (emptyAtTail-- > 1) {
      const voiceChannel = voiceChannels.pop();

      deletionPromises.push(voiceChannel.delete()
        .then(() => this.logger.ok(`Deleted voice channel ${voiceChannel.name}`))
        .catch(e => this.logger.err("Failed to delete channel ${voiceChannel.name}", e))
      )
    }
    await Promise.all(deletionPromises)
  }

  async createVoiceChannel(category, number) {
    const newChannelName = this.getVoiceChannelName(number);
    const channelProps = {
      type: "GUILD_VOICE",
      parent: category,
      userLimit: this.categoryConfig["autoVoiceSlots"],
      bitrate: this.categoryConfig["autoVoiceBitrate"]
    }

    const autoVoicePermissions = this.categoryConfig["autoVoicePermissions"];
    const isSync = typeof autoVoicePermissions === "string" && autoVoicePermissions === "sync";

    if (isSync) {
      channelProps.permissionOverwrites = [
        {id: this.category.guild.roles.everyone.id, deny: ['VIEW_CHANNEL']}
      ]
    } else if (Array.isArray(autoVoicePermissions) && autoVoicePermissions.length > 0) {
      channelProps.permissionOverwrites = [...autoVoicePermissions]
    }

    if (channelProps.permissionOverwrites != null) {
      channelProps.permissionOverwrites.push({id: this.client.user.id, allow: ['VIEW_CHANNEL', 'CONNECT']})
    }

    const newChannel = await category.guild.channels.create(newChannelName, channelProps)

    if (isSync) {
      await newChannel.lockPermissions();
    }

    this.logger.ok(`Created voice channel ${newChannel.name}`)
  }

  getAllVoiceChannels(categoryId) {
    return this.client.channels.cache
      .filter(channel => channel.type === "GUILD_VOICE")
      .filter(channel => channel.parentId === categoryId);
  }

  getAutoVoiceChannels(categoryId) {
    const result = [];
    let num = 0;

    while (true) {
      const channels = this.getChannels(categoryId, "GUILD_VOICE", this.getVoiceChannelName(++num))
      if (channels.length === 0) break

      result.push(...channels)
    }

    return result;
  }

  getVoiceChannelName(number) {
    const prefix = this.categoryConfig["autoVoicePrefix"]
    return number === 1 ? prefix : `${prefix} ${number}`;
  }

  getChannels(categoryId, type, name) {
    return Array.from(
      this.client.channels.cache
        .filter(channel => channel.type === type)
        .filter(channel => channel.parentId === categoryId)
        .filter(channel => channel.name === name)
        .values()
    )
  }
}

module.exports = CategoryHandler;