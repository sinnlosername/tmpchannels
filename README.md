# /tmp/channels

/tmp/channels is a discord bot which allows you to automatically create temporary text and voice channels, when required

## Features
- Temporary text channels for voice channels
- Temporary voice channels on demand
- Per-category configuration
- Easy installation using [docker](https://www.docker.com/)

## Installation
1. Clone the GitHub repository using `git clone <url>`
2. Copy `config.default.toml` to `config.toml`
3. Edit the configuration according to [Configuration](#configuration)
4. Build the docker image using `docker build -t tmpchannels .`
5. Run the image using `docker run -d --name "<container name>" tmpchannels `
6. Check if the bot is running using `docker ps`

Repeat last two steps whenever the configuration is changed.

## Configuration

Key | Value
------------ | -------------
general.token | A valid discord bot token. You can retrieve it from the [discord developer console](https://discord.com/developers/applications)
category.categoryId | The id of the category you want to configure the bot for. See [Retrieving Ids](#retrieving-ids) for further information
category.autoText | Whether or not text channels should be generated in this category
category.autoTextPrefix | A prefix for the generated text channels
categpry.autoTextPosition | Whether text channels should be generated at the `top` or the `bottom` of a category
category.autoVoice | Whether or not voice channels should be generated in this category
category.autoVoicePrefix | A prefix for the generated voice channels
category.autoVoiceSlots | The amount of slots a generated voice channel should have. Omit for unlimited
category.autoVoiceChannelLimit | The limit for generated voice channels in this category
category.autoVoiceBitrate | The bitrate (in bits) a generated voice channel should have. Omit for default bitrate
category.autoVoicePermissions | The permissions a generated voice channel should have. See [Voice Permissions](#voice-permissions) for details. Omit for default permissions

### Voice permissions
Voice permissions can either be set to `"sync"` to use the categories default permissions or to an array containing the permissions.

The array can contain one or many of the following:
- `{ id = "<role id>", allow = "<permission>" }`
- `{ id = "<role id>", deny = "<permission>" }`

See [discord developer portal](https://discord.com/developers/docs/topics/permissions) for a list of permissions

### Retrieving Ids
- Enable `Developer mode` in Discord Settings -> Appearence 
- Right-click a category and press `Copy ID` to copy a channel id
- Right-click a role in role settings and press `Copy ID` to copy a role id

