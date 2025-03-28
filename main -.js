// Import required packages
const { Client, GatewayIntentBits, Partials, Collection, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, ApplicationCommandOptionType, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const https = require('https');
const axios = require('axios');
const crypto = require('crypto');

// Add this at the beginning of your bot code to see detailed API errors
axios.interceptors.response.use(
  response => response,
  error => {
    console.error('API Error:', error.response?.status, JSON.stringify(error.response?.data, null, 2));
    return Promise.reject(error);
  }
);

// Create the client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

// Configuration
const config = {
  token: 'bot-token',
  whitelistRoleId: '1',
  modpackChannelId: '1',
  joinChannelId: '1',
  rulesChannelId: '1'
};

config.minecraft = {
    pterodactyl: {
      apiUrl: ``,
      apiKey: '',
      serverId: ''
    },
    whitelistPath: '/home/container/whitelist.json'
  };
  

// Create database folder if it doesn't exist
const dbFolder = path.join(__dirname, 'database');
if (!fs.existsSync(dbFolder)) {
  fs.mkdirSync(dbFolder);
}

// Database files
const DB_FILES = {
  WHITELIST: path.join(dbFolder, 'whitelist.json'),
  REPUTATION: path.join(dbFolder, 'reputation.json'),
  CLANS: path.join(dbFolder, 'clans.json')
};

// Initialize database files if they don't exist
for (const file of Object.values(DB_FILES)) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({}));
  }
}

// Load databases
const loadDatabase = (filePath) => {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error loading database from ${filePath}:`, error);
    return {};
  }
};

// Save databases
const saveDatabase = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`Error saving database to ${filePath}:`, error);
    return false;
  }
};

// Function to fetch Minecraft UUID for a username
function getMinecraftUUID(username, offlineMode = false) {
  return new Promise((resolve, reject) => {
    // If offline mode is explicitly requested, generate offline UUID
    if (offlineMode) {
      resolve(generateOfflineUUID(username));
      return;
    }

    // Try to get online UUID first
    const url = `https://api.mojang.com/users/profiles/minecraft/${username}`;
    
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const profile = JSON.parse(data);
            // Format the online UUID with dashes
            resolve(generateOfflineUUID(username));
          } else {
            // If online UUID lookup fails, generate offline UUID
            resolve(generateOfflineUUID(username));
          }
        } catch (error) {
          console.error('Error parsing UUID data:', error);
          // Fall back to offline UUID in case of parsing error
          resolve(generateOfflineUUID(username));
        }
      });
    }).on('error', (error) => {
      console.error('Error fetching UUID:', error);
      // Fall back to offline UUID in case of network error
      resolve(generateOfflineUUID(username));
    });
  });
}

function generateOfflineUUID(username) {
  // Create MD5 hash of "OfflinePlayer:" + username
  const inputStr = "OfflinePlayer:" + username;
  const md5Hex = crypto.createHash('md5').update(inputStr, 'utf8').digest('hex');

  // Convert hex to byte array
  const bytes = [];
  for (let i = 0; i < 32; i += 2) {
      bytes.push(parseInt(md5Hex.substr(i, 2), 16));
  }

  // Force version = 3 (bits 12-15 of time_hi_and_version)
  bytes[6] = (bytes[6] & 0x0f) | 0x30;

  // Force variant = 2 (bits 6-7 of clock_seq_hi_and_reserved)
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  // Convert to canonical UUID string (8-4-4-4-12)
  const toHex = (b) => ('0' + b.toString(16)).slice(-2);
  return (
      toHex(bytes[0]) + toHex(bytes[1]) + toHex(bytes[2]) + toHex(bytes[3]) + '-' +
      toHex(bytes[4]) + toHex(bytes[5]) + '-' +
      toHex(bytes[6]) + toHex(bytes[7]) + '-' +
      toHex(bytes[8]) + toHex(bytes[9]) + '-' +
      toHex(bytes[10]) + toHex(bytes[11]) + toHex(bytes[12]) + 
      toHex(bytes[13]) + toHex(bytes[14]) + toHex(bytes[15])
  );
}

// Function to update Minecraft whitelist
async function updateMinecraftWhitelist() {
  console.log('Updating Minecraft whitelist...');
  const whitelistDb = loadDatabase(DB_FILES.WHITELIST);
  const filePath = '/whitelist.json'; // The file path within the container

  try {
    // Request the download URL for the whitelist file
    const downloadResponse = await axios({
      method: 'GET',
      url: `${config.minecraft.pterodactyl.apiUrl}/files/download`,
      headers: {
        'Authorization': `Bearer ${config.minecraft.pterodactyl.apiKey}`,
        'Accept': 'application/json'
      },
      params: { file: filePath }
    });

    // The API returns a temporary URL in response.data.attributes.url
    if (!downloadResponse.data || !downloadResponse.data.attributes || !downloadResponse.data.attributes.url) {
      throw new Error('Failed to retrieve a download URL from Pterodactyl.');
    }
    const downloadUrl = downloadResponse.data.attributes.url;

    //  Download the file content using the pre-signed URL
    const fileResponse = await axios({
      method: 'GET',
      url: downloadUrl,
      responseType: 'text'
    });

    let minecraftWhitelist = [];
    try {
      if (typeof fileResponse.data === 'string') {
        minecraftWhitelist = JSON.parse(fileResponse.data);
      } else {
        minecraftWhitelist = fileResponse.data; // If it's already an object
      }
    
      // Ensure it's an array
      if (!Array.isArray(minecraftWhitelist)) {
        throw new Error('Parsed whitelist is not an array');
      }
    
      console.log('Successfully downloaded existing whitelist');
    } catch (error) {
      console.error('Error parsing whitelist or invalid format:', error);
      minecraftWhitelist = [];
    }
    

    // Merge the Discord whitelist with the Minecraft whitelist
    let updated = false;
    for (const [userId, username] of Object.entries(whitelistDb)) {
      if (!minecraftWhitelist.some(entry => entry.name === username)) {
        const uuid = await getMinecraftUUID(username) || "";
        minecraftWhitelist.push({ uuid: uuid, name: username });
        updated = true;
        console.log(`Added ${username} to Minecraft whitelist`);
      }
    }

    // If there are changes, update the file on the panel
    if (updated) {

      await axios({
        method: 'POST',
        url: `${config.minecraft.pterodactyl.apiUrl}/files/write?file=${filePath}`,
        headers: {
          'Authorization': `Bearer ${config.minecraft.pterodactyl.apiKey}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        data: minecraftWhitelist
      });
      
      
      console.log('Minecraft whitelist updated successfully.');
  
    } else {
      console.log('No changes needed for Minecraft whitelist.');
    }
  } catch (error) {
    console.error('Error updating Minecraft whitelist:', error.response?.data || error.message);
  }

  await sendServerCommand('whitelist reload');
}

async function sendServerCommand(command) {
  try {

    await axios({
      method: 'POST',
      url: `${config.minecraft.pterodactyl.apiUrl}/command`,
      headers: {
        'Authorization': `Bearer ${config.minecraft.pterodactyl.apiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      data: {
        'command': command
      }
    });

    console.log(`Command sent: ${command}`);
  } catch (error) {
    console.error('Error sending command:', error.response?.data || error.message);
  }
}

async function RetriveConsole(lines) {
  // Not coded yet
}

// Ready event
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  registerCommands();

    // Initial whitelist update
    updateMinecraftWhitelist();
  
    // Schedule regular updates (every 60 minutes)
    setInterval(updateMinecraftWhitelist, 60 * 60 * 1000);
});

// Register slash commands
async function registerCommands() {
  const commands = [
    {
      name: 'whitelist',
      description: 'Whitelist a Minecraft username',
      options: [
        {
          name: 'username',
          description: 'Your Minecraft username',
          type: ApplicationCommandOptionType.String,
          required: true
        }
      ]
    },
    {
      name: 'force_whitelist',
      description: 'Force whitelist a user with a specific username (Admin only)',
      options: [
        {
          name: 'user',
          description: 'Discord user to whitelist',
          type: ApplicationCommandOptionType.User,
          required: true
        },
        {
          name: 'username',
          description: 'Minecraft username',
          type: ApplicationCommandOptionType.String,
          required: true
        }
      ],
      defaultMemberPermissions: PermissionFlagsBits.Administrator
    },
    {
      name: 'unwhitelist',
      description: 'Remove yourself from the whitelist'
    },
    {
      name: 'force_unwhitelist',
      description: 'Force unwhitelist a user (Admin only)',
      options: [
        {
          name: 'user',
          description: 'Discord user to unwhitelist',
          type: ApplicationCommandOptionType.User,
          required: false
        },
        {
          name: 'username',
          description: 'Minecraft username to unwhitelist',
          type: ApplicationCommandOptionType.String,
          required: false
        }
      ],
      defaultMemberPermissions: PermissionFlagsBits.Administrator
    },
    {
      name: 'show_whitelist',
      description: 'Show all whitelisted users',
      defaultMemberPermissions: PermissionFlagsBits.Administrator
    },
    {
      name: 'rep',
      description: 'View or add reputation to a user',
      options: [
        {
          name: 'user',
          description: 'Discord user to give reputation to',
          type: ApplicationCommandOptionType.User,
          required: true
        },
        {
          name: 'type',
          description: 'Type of reputation',
          type: ApplicationCommandOptionType.String,
          required: true,
          choices: [
            { name: 'Good', value: 'good' },
            { name: 'Bad', value: 'bad' }
          ]
        },
        {
          name: 'reason',
          description: 'Reason for reputation',
          type: ApplicationCommandOptionType.String,
          required: true
        }
      ]
    },
    {
      name: 'viewrep',
      description: 'View reputation of a user',
      options: [
        {
          name: 'user',
          description: 'Discord user to view reputation',
          type: ApplicationCommandOptionType.User,
          required: true
        }
      ]
    },
    {
      name: 'setrep',
      description: 'Set reputation for a user (Admin only)',
      options: [
        {
          name: 'user',
          description: 'Discord user to set reputation',
          type: ApplicationCommandOptionType.User,
          required: true
        },
        {
          name: 'value',
          description: 'Reputation value',
          type: ApplicationCommandOptionType.Integer,
          required: true
        }
      ],
      defaultMemberPermissions: PermissionFlagsBits.Administrator
    },
    {
      name: 'resetrep',
      description: 'Reset reputation for a user (Admin only)',
      options: [
        {
          name: 'user',
          description: 'Discord user to reset reputation',
          type: ApplicationCommandOptionType.User,
          required: true
        }
      ],
      defaultMemberPermissions: PermissionFlagsBits.Administrator
    },
    {
      name: 'modpack',
      description: 'Get information about the modpack and how to join'
    },
    {
      name: 'help',
      description: 'Show available commands'
    },
    {
      name: 'rules',
      description: 'View server rules'
    },
    {
      name: 'clan',
      description: 'Clan management',
      options: [
        {
          name: 'create',
          description: 'Create a new clan',
          type: ApplicationCommandOptionType.Subcommand,
          options: [
            {
              name: 'name',
              description: 'Clan name',
              type: ApplicationCommandOptionType.String,
              required: true
            },
            {
              name: 'icon',
              description: 'Clan icon (emoji)',
              type: ApplicationCommandOptionType.String,
              required: true
            }
          ]
        },
        {
          name: 'join',
          description: 'Join a clan',
          type: ApplicationCommandOptionType.Subcommand,
          options: [
            {
              name: 'name',
              description: 'Clan name',
              type: ApplicationCommandOptionType.String,
              required: true
            }
          ]
        },
        {
          name: 'leave',
          description: 'Leave your current clan',
          type: ApplicationCommandOptionType.Subcommand
        },
        {
          name: 'info',
          description: 'Get information about a clan',
          type: ApplicationCommandOptionType.Subcommand,
          options: [
            {
              name: 'name',
              description: 'Clan name',
              type: ApplicationCommandOptionType.String,
              required: true
            }
          ]
        },
        {
          name: 'list',
          description: 'List all clans',
          type: ApplicationCommandOptionType.Subcommand
        },
        {
          name: 'ally',
          description: 'Add an ally to your clan',
          type: ApplicationCommandOptionType.Subcommand,
          options: [
            {
              name: 'name',
              description: 'Clan name',
              type: ApplicationCommandOptionType.String,
              required: true
            }
          ]
        },
        {
          name: 'enemy',
          description: 'Add an enemy to your clan',
          type: ApplicationCommandOptionType.Subcommand,
          options: [
            {
              name: 'name',
              description: 'Clan name',
              type: ApplicationCommandOptionType.String,
              required: true
            }
          ]
        },
        {
          name: 'delete',
          description: 'Delete your clan (Leader only)',
          type: ApplicationCommandOptionType.Subcommand
        }
      ]
    },
    {
      name: 'console',
      description: 'Server console commands',
      options: [
        {
          name: 'send',
          description: 'Send a command to the console',
          type: ApplicationCommandOptionType.Subcommand,
          options: [
            {
              name: 'message',
              description: 'Console message or command to send',
              type: ApplicationCommandOptionType.String,
              required: true
            }
          ]
        },
        {
          name: 'retrieve',
          description: 'Retrieve console logs',
          type: ApplicationCommandOptionType.Subcommand,
          options: [
            {
              name: 'limit',
              description: 'Number of log entries to retrieve',
              type: ApplicationCommandOptionType.Integer,
              required: false
            }
          ]
        }
      ]
    },
    {
      name: 'force_deleteclan',
      description: 'Force delete a clan (Admin only)',
      options: [
        {
          name: 'name',
          description: 'Clan name',
          type: ApplicationCommandOptionType.String,
          required: true
        }
      ],
      defaultMemberPermissions: PermissionFlagsBits.Administrator
    }
  ];

  try {
    console.log('Started refreshing application (/) commands.');
    await client.application.commands.set(commands);
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

// Command handlers
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName, options } = interaction;

  // Whitelist command
  if (commandName === 'whitelist') {
    const username = options.getString('username');
    const userId = interaction.user.id;
    const whitelistDb = loadDatabase(DB_FILES.WHITELIST);

    // Check if user is already whitelisted
    if (whitelistDb[userId]) {
      return interaction.reply({ content: `You are already whitelisted as ${whitelistDb[userId]}!`, ephemeral: true });
    }

    // Save to whitelist database
    whitelistDb[userId] = username;
    saveDatabase(DB_FILES.WHITELIST, whitelistDb);

    // Rename user
    try {
      const member = interaction.guild.members.cache.get(userId);
      await member.setNickname(`${member.user.displayName}(${username})`);
    } catch (error) {
      console.error('Error renaming user:', error);
    }

    // Add whitelist role
    try {
      const member = interaction.guild.members.cache.get(userId);
      await member.roles.add(config.whitelistRoleId);
    } catch (error) {
      console.error('Error adding role:', error);
    }

    updateMinecraftWhitelist();
    interaction.reply({ content: `You have been whitelisted as ${username}!`, ephemeral: true });
  }

  // Unwhitelist command
else if (commandName === 'unwhitelist') {
  const userId = interaction.user.id;
  const whitelistDb = loadDatabase(DB_FILES.WHITELIST);

  // Check if user is whitelisted
  if (!whitelistDb[userId]) {
    return interaction.reply({ content: 'You are not currently whitelisted.', ephemeral: true });
  }

  const username = whitelistDb[userId];
  
  // Remove from whitelist database
  delete whitelistDb[userId];
  saveDatabase(DB_FILES.WHITELIST, whitelistDb);

  // Remove whitelist role
  try {
    const member = interaction.guild.members.cache.get(userId);
    await member.roles.remove(config.whitelistRoleId);
    
    // Reset nickname if possible
    try {
      if (member.nickname && member.nickname.includes('(')) {
        await member.setNickname(member.nickname.split('(')[0].trim());
      }
    } catch (error) {
      console.error('Error resetting nickname:', error);
    }
  } catch (error) {
    console.error('Error removing role:', error);
  }

  updateMinecraftWhitelist();
  interaction.reply({ content: `You have been removed from the whitelist. Your Minecraft username (${username}) will be removed from the server whitelist on the next update.`, ephemeral: true });
}

// Force unwhitelist command
else if (commandName === 'force_unwhitelist') {
  const user = options.getUser('user');
  const username = options.getString('username');
  const whitelistDb = loadDatabase(DB_FILES.WHITELIST);
  
  // Check if at least one option is provided
  if (!user && !username) {
    return interaction.reply({ content: 'You must provide either a Discord user or a Minecraft username to unwhitelist.', ephemeral: true });
  }

  if (user) {
    // Check if user is whitelisted
    if (!whitelistDb[user.id]) {
      return interaction.reply({ content: `${user.tag} is not currently whitelisted.`, ephemeral: true });
    }

    const mcUsername = whitelistDb[user.id];
    
    // Remove from whitelist database
    delete whitelistDb[user.id];
    saveDatabase(DB_FILES.WHITELIST, whitelistDb);

    // Remove whitelist role
    try {
      const member = interaction.guild.members.cache.get(user.id);
      await member.roles.remove(config.whitelistRoleId);
      
      // Reset nickname if possible
      try {
        if (member.nickname && member.nickname.includes('(')) {
          await member.setNickname(member.nickname.split('(')[0].trim());
        }
      } catch (error) {
        console.error('Error resetting nickname:', error);
      }
    } catch (error) {
      console.error('Error removing role:', error);
    }

    updateMinecraftWhitelist();
    interaction.reply({ content: `You have unwhitelisted ${user.tag} (${mcUsername}). They will be removed from the server whitelist on the next update.`, ephemeral: true });
  } else {
    // Find Discord user by Minecraft username
    let foundUserId = null;
    let foundUserTag = null;
    
    for (const [userId, mcUsername] of Object.entries(whitelistDb)) {
      if (mcUsername.toLowerCase() === username.toLowerCase()) {
        foundUserId = userId;
        try {
          const user = await client.users.fetch(userId);
          foundUserTag = user.tag;
        } catch (error) {
          console.error('Error fetching user:', error);
          foundUserTag = 'Unknown User';
        }
        break;
      }
    }

    if (!foundUserId) {
      return interaction.reply({ content: `No Discord user found with Minecraft username ${username}.`, ephemeral: true });
    }

    // Remove from whitelist database
    delete whitelistDb[foundUserId];
    saveDatabase(DB_FILES.WHITELIST, whitelistDb);

    // Remove whitelist role
    try {
      const member = interaction.guild.members.cache.get(foundUserId);
      if (member) {
        await member.roles.remove(config.whitelistRoleId);
        
        // Reset nickname if possible
        try {
          if (member.nickname && member.nickname.includes('(')) {
            await member.setNickname(member.nickname.split('(')[0].trim());
          }
        } catch (error) {
          console.error('Error resetting nickname:', error);
        }
      }
    } catch (error) {
      console.error('Error removing role:', error);
    }

    updateMinecraftWhitelist();
    interaction.reply({ content: `You have unwhitelisted ${foundUserTag} (${username}). They will be removed from the server whitelist on the next update.`, ephemeral: true });
  }
}

// Send command to the console
else if (commandName === 'console') {
  if (subcommand === 'send') {
    const message = options.getString('message');
    sendServerCommand(message);

    interaction.reply({ content: `Successfully sent the command \`${message}\``, ephemeral: false });
  } else if (subcommand === 'retrieve') {
    const limit = options.getInteger('limit') || 10;
    const logs = RetriveConsole(limit);

    const consoleEmbed = new EmbedBuilder()
      .setColor('#72fd53')
      .setTitle('Console Logs')
      .setDescription('```json\n' + JSON.stringify(logs, null, 2) + '\n```')
      .setTimestamp();

    interaction.reply({ embeds: [consoleEmbed], ephemeral: false });
  }
}

// Show whitelist command
else if (commandName === 'show_whitelist') {
  const whitelistDb = loadDatabase(DB_FILES.WHITELIST);
  
  if (Object.keys(whitelistDb).length === 0) {
    return interaction.reply({ content: 'No users are currently whitelisted.', ephemeral: true });
  }

  // Create pages for whitelist (10 users per page)
  const whitelistEntries = Object.entries(whitelistDb);
  const chunkSize = 10;
  const pages = [];
  
  for (let i = 0; i < whitelistEntries.length; i += chunkSize) {
    const chunk = whitelistEntries.slice(i, i + chunkSize);
    pages.push(chunk);
  }
  
  // Create initial embed
  const createEmbed = async (pageIndex) => {
    const embed = new EmbedBuilder()
      .setTitle('Whitelist')
      .setDescription(`Showing users ${pageIndex * chunkSize + 1} to ${Math.min((pageIndex + 1) * chunkSize, whitelistEntries.length)} of ${whitelistEntries.length}`)
      .setColor('#72fd53')
      .setFooter({ text: `Page ${pageIndex + 1}/${pages.length}` });
    
    // Add users to embed
    for (const [userId, username] of pages[pageIndex]) {
      try {
        const user = await client.users.fetch(userId);
        embed.addFields({ name: username, value: `<@${userId}> (${user.tag})`, inline: true });
      } catch (error) {
        embed.addFields({ name: username, value: `<@${userId}> (Unknown User)`, inline: true });
      }
    }
    
    return embed;
  };
  
  // Create buttons
  const createButtons = (pageIndex) => {
    const row = new ActionRowBuilder();
    
    // Previous page button
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`whitelist_prev_${pageIndex}`)
        .setLabel('◀️ Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(pageIndex === 0)
    );
    
    // Next page button
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`whitelist_next_${pageIndex}`)
        .setLabel('Next ▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(pageIndex === pages.length - 1)
    );
    
    return row;
  };
  
  // Send initial embed
  const embed = await createEmbed(0);
  const message = await interaction.reply({ embeds: [embed], components: [createButtons(0)], fetchReply: true });
  
  // Create collector for button interactions
  const collector = message.createMessageComponentCollector({ time: 5 * 60 * 1000 }); // 5 minutes
  
  collector.on('collect', async (i) => {
    // Only allow the command user to interact with buttons
    if (i.user.id !== interaction.user.id) {
      return i.reply({ content: 'These buttons are not for you!', ephemeral: true });
    }
    
    // Get current page from button ID
    const currentPage = parseInt(i.customId.split('_')[2]);
    let newPage = currentPage;
    
    // Update page based on button
    if (i.customId.startsWith('whitelist_prev')) {
      newPage = Math.max(0, currentPage - 1);
    } else if (i.customId.startsWith('whitelist_next')) {
      newPage = Math.min(pages.length - 1, currentPage + 1);
    }
    
    // Update embed
    const newEmbed = await createEmbed(newPage);
    const newButtons = createButtons(newPage);
    
    await i.update({ embeds: [newEmbed], components: [newButtons] });
  });
  
  collector.on('end', () => {
    interaction.editReply({ components: [] }).catch(console.error);
  });
}

  // Force whitelist command
else if (commandName === 'force_whitelist') {
    const user = options.getUser('user');
    const username = options.getString('username');
    const whitelistDb = loadDatabase(DB_FILES.WHITELIST);

    // Save to whitelist database
    whitelistDb[user.id] = username;
    saveDatabase(DB_FILES.WHITELIST, whitelistDb);

    // Rename user
    try {
      const member = interaction.guild.members.cache.get(user.id);
      await member.setNickname(`${username.split(/[^a-zA-Z0-9_]/)[0]}(${username})`);
    } catch (error) {
      console.error('Error renaming user:', error);
    }

    // Add whitelist role
    try {
      const member = interaction.guild.members.cache.get(user.id);
      await member.roles.add(config.whitelistRoleId);
    } catch (error) {
      console.error('Error adding role:', error);
    }

    updateMinecraftWhitelist();
    interaction.reply({ content: `You have force-whitelisted ${user.tag} as ${username}!`, ephemeral: true });
}

  // Rep command
  else if (commandName === 'rep') {
    const member = interaction.guild.members.cache.get(user.id);
    const user = options.getUser('user');
    const type = options.getString('type');
    const reason = options.getString('reason');
    const repDb = loadDatabase(DB_FILES.REPUTATION);

    if (member.id == user.id) {
        interaction.reply({ 
            content: `You gave can't give yourself Rep.`,
            ephemeral: false
          });
        return;
    }



    // Initialize user in rep database if not exists
    if (!repDb[user.id]) {
      repDb[user.id] = {
        score: 0,
        vouches: []
      };
    }
    

    // Update reputation
    const scoreChange = type === 'good' ? 1 : -1;
    repDb[user.id].score += scoreChange;

    // Add vouch
    repDb[user.id].vouches.push({
      from: interaction.user.id,
      type: type,
      reason: reason,
      timestamp: Date.now()
    });

    saveDatabase(DB_FILES.REPUTATION, repDb);

    interaction.reply({ 
      content: `You gave ${type} reputation to ${user.tag} for "${reason}". Their current reputation is ${repDb[user.id].score}.`,
      ephemeral: false
    });
  }

  // View rep command
  else if (commandName === 'viewrep') {
    const user = options.getUser('user');
    const repDb = loadDatabase(DB_FILES.REPUTATION);

    if (!repDb[user.id]) {
      return interaction.reply({ content: `${user.tag} has no reputation yet.`, ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle(`${user.tag}'s Reputation`)
      .setDescription(`Current Score: ${repDb[user.id].score}`)
      .setColor(repDb[user.id].score >= 0 ? '#00FF00' : '#FF0000')
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        { name: 'Recent Vouches', value: repDb[user.id].vouches.length > 0 ? '\u200B' : 'No vouches yet' }
      );

    // Add recent vouches (last 5)
    const recentVouches = repDb[user.id].vouches.slice(-5).reverse();
    for (const vouch of recentVouches) {
      const fromUser = await client.users.fetch(vouch.from);
      embed.addFields({
        name: `${vouch.type === 'good' ? '👍' : '👎'} From ${fromUser.tag}`,
        value: `"${vouch.reason}" - <t:${Math.floor(vouch.timestamp / 1000)}:R>`
      });
    }

    interaction.reply({ embeds: [embed] });
  }

  // Set rep command
  else if (commandName === 'setrep') {
    const user = options.getUser('user');
    const value = options.getInteger('value');
    const repDb = loadDatabase(DB_FILES.REPUTATION);

    // Initialize user in rep database if not exists
    if (!repDb[user.id]) {
      repDb[user.id] = {
        score: 0,
        vouches: []
      };
    }

    // Update reputation
    repDb[user.id].score = value;

    // Add admin note
    repDb[user.id].vouches.push({
      from: interaction.user.id,
      type: 'admin',
      reason: `Admin set reputation to ${value}`,
      timestamp: Date.now()
    });

    saveDatabase(DB_FILES.REPUTATION, repDb);

    interaction.reply({ 
      content: `You set ${user.tag}'s reputation to ${value}.`,
      ephemeral: true
    });
  }

  // Reset rep command
  else if (commandName === 'resetrep') {
    const user = options.getUser('user');
    const repDb = loadDatabase(DB_FILES.REPUTATION);

    // Initialize user in rep database if not exists
    if (!repDb[user.id]) {
      repDb[user.id] = {
        score: 0,
        vouches: []
      };
    }

    // Reset reputation
    repDb[user.id].score = 0;
    repDb[user.id].vouches = [];

    saveDatabase(DB_FILES.REPUTATION, repDb);

    interaction.reply({ 
      content: `You reset ${user.tag}'s reputation.`,
      ephemeral: true
    });
  }

  // Modpack command
  else if (commandName === 'modpack') {
    const embed = new EmbedBuilder()
      .setTitle('Minecraft SMP Modpack Information')
      .setDescription('Here are the links to get started with our SMP:')
      .setColor('#72fd53')
      .addFields(
        { name: 'Quickstart Guide', value: `<#${config.modpackChannelId}>` },
        { name: 'How to Join', value: `<#${config.joinChannelId}>` }
      );

    interaction.reply({ embeds: [embed] });
  }

  // Help command
// Help command
else if (commandName === 'help') {
  // Define help pages
  const helpPages = [
    {
      title: 'General Commands',
      fields: [
        { name: '/help', value: 'Show this help menu' },
        { name: '/rules', value: 'View server rules' },
        { name: '/modpack', value: 'Get information about the modpack and how to join' }
      ]
    },
    {
      title: 'Whitelist Commands',
      fields: [
        { name: '/whitelist {username}', value: 'Whitelist your Minecraft username' },
        { name: '/unwhitelist', value: 'Remove yourself from the whitelist' }
      ]
    },
    {
      title: 'Reputation Commands',
      fields: [
        { name: '/rep {user} {good/bad} {reason}', value: 'Give reputation to a user' },
        { name: '/viewrep {user}', value: 'View a user\'s reputation' }
      ]
    },
    {
      title: 'Clan Commands',
      fields: [
        { name: '/clan create {name} {icon}', value: 'Create a new clan' },
        { name: '/clan join {name}', value: 'Join an existing clan' },
        { name: '/clan leave', value: 'Leave your current clan' },
        { name: '/clan info {name}', value: 'Get information about a clan' },
        { name: '/clan list', value: 'List all clans' },
        { name: '/clan ally {name}', value: 'Add an ally to your clan (Leader only)' },
        { name: '/clan enemy {name}', value: 'Add an enemy to your clan (Leader only)' },
        { name: '/clan delete', value: 'Delete your clan (Leader only)' }
      ]
    }
  ];
  
  // Add admin commands if user has admin permissions
  if (interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    helpPages.push({
      title: 'Admin Commands',
      fields: [
        { name: '/force_whitelist {user} {username}', value: 'Force whitelist a user with a specific username' },
        { name: '/force_unwhitelist {user/username}', value: 'Force unwhitelist a user either by Discord mention or Minecraft username' },
        { name: '/show_whitelist', value: 'Show all whitelisted users with their Discord accounts' },
        { name: '/setrep {user} {value}', value: 'Set a user\'s reputation score' },
        { name: '/resetrep {user}', value: 'Reset a user\'s reputation' },
        { name: '/force_deleteclan {name}', value: 'Force delete a clan' }
      ]
    });
  }
  
  // Create initial embed
  const createEmbed = (pageIndex) => {
    const page = helpPages[pageIndex];
    
    const embed = new EmbedBuilder()
      .setTitle(`Help: ${page.title}`)
      .setDescription('Here are the available commands:')
      .setColor('#72fd53')
      .setFooter({ text: `Page ${pageIndex + 1}/${helpPages.length}` });
    
    // Add fields
    for (const field of page.fields) {
      embed.addFields({ name: field.name, value: field.value });
    }
    
    return embed;
  };
  
  // Create buttons
  const createButtons = (pageIndex) => {
    const row = new ActionRowBuilder();
    
    // Previous page button
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`help_prev_${pageIndex}`)
        .setLabel('◀️ Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(pageIndex === 0)
    );
    
    // Next page button
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`help_next_${pageIndex}`)
        .setLabel('Next ▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(pageIndex === helpPages.length - 1)
    );
    
    return row;
  };
  
  // Send initial embed
  const embed = createEmbed(0);
  const message = await interaction.reply({ embeds: [embed], components: [createButtons(0)], ephemeral: true, fetchReply: true });
  
  // Create collector for button interactions
  const collector = message.createMessageComponentCollector({ time: 5 * 60 * 1000 }); // 5 minutes
  
  collector.on('collect', async (i) => {
    // Only allow the command user to interact with buttons
    if (i.user.id !== interaction.user.id) {
      return i.reply({ content: 'These buttons are not for you!', ephemeral: true });
    }
    
    // Get current page from button ID
    const currentPage = parseInt(i.customId.split('_')[2]);
    let newPage = currentPage;
    
    // Update page based on button
    if (i.customId.startsWith('help_prev')) {
      newPage = Math.max(0, currentPage - 1);
    } else if (i.customId.startsWith('help_next')) {
      newPage = Math.min(helpPages.length - 1, currentPage + 1);
    }
    
    // Update embed
    const newEmbed = createEmbed(newPage);
    const newButtons = createButtons(newPage);
    
    await i.update({ embeds: [newEmbed], components: [newButtons] });
  });
  
  collector.on('end', () => {
    interaction.editReply({ components: [] }).catch(console.error);
  });
}

  // Rules command
  else if (commandName === 'rules') {
    const embed = new EmbedBuilder()
      .setTitle('Server Rules')
      .setDescription(`Please read our server rules here: <#${config.rulesChannelId}>`)
      .setColor('#72fd53');

    interaction.reply({ embeds: [embed] });
  }

  // Clan commands
  else if (commandName === 'clan') {
    const subcommand = options.getSubcommand();
    const clansDb = loadDatabase(DB_FILES.CLANS);

    // Create subcommand
    if (subcommand === 'create') {
      const name = options.getString('name');
      const icon = options.getString('icon');
      
      // Check if clan name already exists
      if (clansDb[name]) {
        return interaction.reply({ content: `A clan with the name "${name}" already exists.`, ephemeral: true });
      }

      // Check if user is already in a clan
      for (const clanName in clansDb) {
        if (clansDb[clanName].members.includes(interaction.user.id) || clansDb[clanName].leader === interaction.user.id) {
          return interaction.reply({ content: 'You are already in a clan. You must leave your current clan first.', ephemeral: true });
        }
      }

      // Create new clan
      clansDb[name] = {
        name,
        icon,
        leader: interaction.user.id,
        members: [],
        allies: [],
        enemies: [],
        createdAt: Date.now()
      };

      saveDatabase(DB_FILES.CLANS, clansDb);

      interaction.reply({ content: `Clan "${name}" ${icon} has been created! You are the leader.` });
    }

    // Join subcommand
    else if (subcommand === 'join') {
      const name = options.getString('name');
      
      // Check if clan exists
      if (!clansDb[name]) {
        return interaction.reply({ content: `No clan with the name "${name}" exists.`, ephemeral: true });
      }

      // Check if user is already in a clan
      for (const clanName in clansDb) {
        if (clansDb[clanName].members.includes(interaction.user.id) || clansDb[clanName].leader === interaction.user.id) {
          return interaction.reply({ content: 'You are already in a clan. You must leave your current clan first.', ephemeral: true });
        }
      }

      // Add user to clan
      clansDb[name].members.push(interaction.user.id);
      saveDatabase(DB_FILES.CLANS, clansDb);

      interaction.reply({ content: `You have joined the clan "${name}" ${clansDb[name].icon}!` });
    }

    // Leave subcommand
    else if (subcommand === 'leave') {
      let userClan = null;
      
      // Find user's clan
      for (const clanName in clansDb) {
        if (clansDb[clanName].members.includes(interaction.user.id)) {
          userClan = clanName;
          break;
        } else if (clansDb[clanName].leader === interaction.user.id) {
          return interaction.reply({ content: 'You are the leader of your clan. You must delete the clan or transfer leadership to leave.', ephemeral: true });
        }
      }

      if (!userClan) {
        return interaction.reply({ content: 'You are not in a clan.', ephemeral: true });
      }

      // Remove user from clan
      clansDb[userClan].members = clansDb[userClan].members.filter(id => id !== interaction.user.id);
      saveDatabase(DB_FILES.CLANS, clansDb);

      interaction.reply({ content: `You have left the clan "${userClan}" ${clansDb[userClan].icon}.` });
    }

    // Info subcommand
    else if (subcommand === 'info') {
      const name = options.getString('name');
      
      // Check if clan exists
      if (!clansDb[name]) {
        return interaction.reply({ content: `No clan with the name "${name}" exists.`, ephemeral: true });
      }

      const clan = clansDb[name];
      const leader = await client.users.fetch(clan.leader);
      
      const embed = new EmbedBuilder()
        .setTitle(`${clan.name} ${clan.icon}`)
        .setDescription(`Leader: ${leader.tag}`)
        .setColor('#72fd53')
        .addFields(
          { name: 'Members', value: clan.members.length > 0 ? `${clan.members.length} members` : 'No members' },
          { 
            name: 'Allies', 
            value: clan.allies.length > 0 ? clan.allies.map(ally => `${ally} ${clansDb[ally]?.icon || ''}`).join('\n') : 'No allies' 
          },
          { 
            name: 'Enemies', 
            value: clan.enemies.length > 0 ? clan.enemies.map(enemy => `${enemy} ${clansDb[enemy]?.icon || ''}`).join('\n') : 'No enemies' 
          },
          { name: 'Created', value: `<t:${Math.floor(clan.createdAt / 1000)}:R>` }
        );

      interaction.reply({ embeds: [embed] });
    }

    // List subcommand
    else if (subcommand === 'list') {
      if (Object.keys(clansDb).length === 0) {
        return interaction.reply({ content: 'There are no clans yet.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('Clans')
        .setDescription('Here are all the clans on the server:')
        .setColor('#72fd53');

      for (const clanName in clansDb) {
        const clan = clansDb[clanName];
        const memberCount = clan.members.length + 1; // +1 for the leader
        embed.addFields({
          name: `${clan.name} ${clan.icon}`,
          value: `${memberCount} members | Leader: <@${clan.leader}>`
        });
      }

      interaction.reply({ embeds: [embed] });
    }

    // Ally subcommand
    else if (subcommand === 'ally') {
      const targetClanName = options.getString('name');
      let userClan = null;
      
      // Find user's clan and check if they are the leader
      for (const clanName in clansDb) {
        if (clansDb[clanName].leader === interaction.user.id) {
          userClan = clanName;
          break;
        }
      }

      if (!userClan) {
        return interaction.reply({ content: 'You are not a clan leader.', ephemeral: true });
      }

      // Check if target clan exists
      if (!clansDb[targetClanName]) {
        return interaction.reply({ content: `No clan with the name "${targetClanName}" exists.`, ephemeral: true });
      }

      // Check if target clan is already an ally
      if (clansDb[userClan].allies.includes(targetClanName)) {
        return interaction.reply({ content: `${targetClanName} is already an ally.`, ephemeral: true });
      }

      // Check if target clan is an enemy
      if (clansDb[userClan].enemies.includes(targetClanName)) {
        clansDb[userClan].enemies = clansDb[userClan].enemies.filter(enemy => enemy !== targetClanName);
      }

      // Add ally
      clansDb[userClan].allies.push(targetClanName);
      saveDatabase(DB_FILES.CLANS, clansDb);

      interaction.reply({ content: `You have added ${targetClanName} ${clansDb[targetClanName].icon} as an ally to your clan.` });
    }

    // Enemy subcommand
    else if (subcommand === 'enemy') {
      const targetClanName = options.getString('name');
      let userClan = null;
      
      // Find user's clan and check if they are the leader
      for (const clanName in clansDb) {
        if (clansDb[clanName].leader === interaction.user.id) {
          userClan = clanName;
          break;
        }
      }

      if (!userClan) {
        return interaction.reply({ content: 'You are not a clan leader.', ephemeral: true });
      }

      // Check if target clan exists
      if (!clansDb[targetClanName]) {
        return interaction.reply({ content: `No clan with the name "${targetClanName}" exists.`, ephemeral: true });
      }

      // Check if target clan is already an enemy
      if (clansDb[userClan].enemies.includes(targetClanName)) {
        return interaction.reply({ content: `${targetClanName} is already an enemy.`, ephemeral: true });
      }

      // Check if target clan is an ally
      if (clansDb[userClan].allies.includes(targetClanName)) {
        clansDb[userClan].allies = clansDb[userClan].allies.filter(ally => ally !== targetClanName);
      }

      // Add enemy
      clansDb[userClan].enemies.push(targetClanName);
      saveDatabase(DB_FILES.CLANS, clansDb);

      interaction.reply({ content: `You have added ${targetClanName} ${clansDb[targetClanName].icon} as an enemy to your clan.` });
    }

    // Delete subcommand
    else if (subcommand === 'delete') {
      let userClan = null;
      
      // Find user's clan and check if they are the leader
      for (const clanName in clansDb) {
        if (clansDb[clanName].leader === interaction.user.id) {
          userClan = clanName;
          break;
        }
      }

      if (!userClan) {
        return interaction.reply({ content: 'You are not a clan leader.', ephemeral: true });
      }

      // Delete clan
      delete clansDb[userClan];
      saveDatabase(DB_FILES.CLANS, clansDb);

      interaction.reply({ content: `You have deleted your clan.` });
    }
  }

  // Force delete clan command
  else if (commandName === 'force_deleteclan') {
    const name = options.getString('name');
    const clansDb = loadDatabase(DB_FILES.CLANS);

    // Check if clan exists
    if (!clansDb[name]) {
      return interaction.reply({ content: `No clan with the name "${name}" exists.`, ephemeral: true });
    }

    // Delete clan
    delete clansDb[name];
    saveDatabase(DB_FILES.CLANS, clansDb);

    interaction.reply({ content: `You have forcefully deleted the clan "${name}".`, ephemeral: true });
  }
});

// Login to Discord
client.login(config.token);