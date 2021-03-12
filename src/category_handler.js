const {Mutex, withTimeout} = require("async-mutex")

class CategoryHandler {
  constructor(baseLogger, client, handlerId, categoryConfig) {
    this.logger = baseLogger.childLogger(`channelHandler:${handlerId}`);
    this.client = client;
    this.categoryConfig = categoryConfig;
    this.channelMutexes = [];

    this.init().catch(this.logger.err);
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
    if (oldState.channelID === newState.channelID) return; // Ignore Mute / Unmute

    await this.getChannelMutex(newState.channelID).runExclusive(async () => {
      try {
        await this.updateTextChannels(
          oldState.channelID == null ? null : await this.client.channels.fetch(oldState.channelID),
          newState.channelID == null ? null : await this.client.channels.fetch(newState.channelID),
          await newState.guild.members.fetch(newState.id)
        );
        await this.updateVoiceChannels();
      } catch (e) {
        this.logger.err(e);
      }
    })
  }

  async updateTextChannels(oldVoiceChannel, newVoiceChannel, member) {
    if (!this.categoryConfig["autoText"]) return;

    await Promise.all([
      this.updateTextChannel(newVoiceChannel, member, true)
        .catch(e => this.logger.err(`Failed to update old text channel for ${oldVoiceChannel.name}`, e)),
      this.updateTextChannel(oldVoiceChannel, member, false)
        .catch(e => this.logger.err(`Failed to update new text channel for ${newVoiceChannel.name}`, e))
    ])
  }

  async updateTextChannel(voiceChannel, member, canSee) {
    if (voiceChannel == null) return;
    if (voiceChannel.parentID !== this.category.id) return;

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

  async updateTextChannelPermissions(member, voiceChannel, textChannel, canSee) {
    if (member.hasPermission("ADMINISTRATOR")) return; // Administrators can always see the channel

    const hasAccess = member.permissionsIn(textChannel).has("VIEW_CHANNEL");
    if (canSee === hasAccess) return;

    await textChannel.updateOverwrite(member.id, {"VIEW_CHANNEL": canSee});
  }

  async updateTextChannelExistence(voiceChannel) {
    const textChannelName = this.getTextChannelName(voiceChannel);
    let textChannel = this.getChannel(this.category.id, "text", textChannelName);

    if (textChannel == null && voiceChannel.members.size > 0) {
      const channelProps = {
        parent: this.category,
        permissionOverwrites: [
          {id: this.category.guild.roles.everyone.id, deny: ['VIEW_CHANNEL']},
          {id: this.client.user.id, allow: ['VIEW_CHANNEL']}
        ],
      };

      if (this.categoryConfig["autoTextPosition"] === "top") {
        channelProps.position = 0;
      }

      textChannel = await this.category.guild.channels.create(textChannelName, channelProps);

      this.logger.ok(`Created text channel ${textChannel.name}`);
    } else if (textChannel != null && voiceChannel.members.size === 0) {
      await textChannel.delete();
      this.logger.ok(`Deleted text channel ${textChannel.name}`);

      textChannel = null;
    }

    return textChannel;
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
      voiceChannels.length = 0 // clear the array
      this.logger.ok(`Reset voice channels in category ${this.category.name}`)
    }

    // Find empty channels at the end
    let emptyAtTail = voiceChannels.reduce((total, voiceChannel) => voiceChannel.members.size > 0 ? 0 : total + 1, 0);
    if (emptyAtTail === 0 && voiceChannels.length < this.categoryConfig["autoVoiceChannelLimit"]) {
      await this.createVoiceChannel(category, voiceChannels.length + 1)
      return;
    }

    const deletionPromises = [];
    while (emptyAtTail > 1) {
      const voiceChannel = voiceChannels.pop();

      deletionPromises.push(voiceChannel.delete()
        .then(() => this.logger.ok(`Deleted voice channel ${voiceChannel.name}`))
        .catch(e => this.logger.err("Failed to delete channel ${voiceChannel.name}", e))
      )

      emptyAtTail--;
    }
    await Promise.all(deletionPromises)
  }

  async createVoiceChannel(category, id) {
    const newChannelName = `${this.categoryConfig["autoVoicePrefix"]} ${id}`;
    const channelProps = {
      type: "voice",
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
      .filter(channel => channel.type === "voice")
      .filter(channel => channel.parentID === categoryId);
  }

  getAutoVoiceChannels(categoryId) {
    const result = [];
    let i = 1, channel;
    while ((channel = this.getChannel(categoryId, "voice", `${this.categoryConfig["autoVoicePrefix"]} ${i++}`)) != null) {
      result.push(channel);
    }
    return result;
  }

  getChannel(categoryId, type, name) {
    return this.client.channels.cache
      .filter(channel => channel.type === type)
      .filter(channel => channel.parentID === categoryId)
      .find(channel => channel.name === name);
  }
}

module.exports = CategoryHandler;