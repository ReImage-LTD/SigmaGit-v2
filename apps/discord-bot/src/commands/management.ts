import {
  EmbedBuilder,
  PermissionFlagsBits,
  TextChannel,
  GuildMember,
  User,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';

// Permission check helper
export function hasPermission(member: GuildMember | null, permission: bigint): boolean {
  if (!member) return false;
  return member.permissions.has(permission) || member.permissions.has(PermissionFlagsBits.Administrator);
}

export function isStaff(member: GuildMember | null): boolean {
  if (!member) return false;
  return (
    hasPermission(member, PermissionFlagsBits.ManageGuild) ||
    hasPermission(member, PermissionFlagsBits.Administrator) ||
    hasPermission(member, PermissionFlagsBits.ManageChannels)
  );
}

// Ticket Management
export async function handleTicketCreate(interaction: any) {
  if (!interaction.guild) {
    await interaction.editReply({ content: '❌ This command can only be used in a server.' });
    return;
  }

  const category = interaction.options.getString('category') || 'general';
  const description = interaction.options.getString('description') || 'No description provided';

  try {
    const ticketChannel = await interaction.guild.channels.create({
      name: `ticket-${interaction.user.username.toLowerCase()}-${Date.now().toString().slice(-4)}`,
      type: ChannelType.GuildText,
      topic: `Ticket created by ${interaction.user.tag} - ${description}`,
      permissionOverwrites: [
        {
          id: interaction.guild.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: interaction.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
        },
      ],
    });

    const embed = new EmbedBuilder()
      .setTitle('🎫 Ticket Created')
      .setDescription(`**Category:** ${category}\n**Description:** ${description}`)
      .setColor(0x00ff00)
      .setFooter({ text: `Created by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
      .setTimestamp();

    const closeButton = new ButtonBuilder()
      .setCustomId(`ticket_close_${ticketChannel.id}`)
      .setLabel('Close Ticket')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(closeButton);

    await ticketChannel.send({ embeds: [embed], components: [row] });
    await ticketChannel.send(`<@${interaction.user.id}> Your ticket has been created! Staff will assist you shortly.`);

    await interaction.editReply({
      content: `✅ Ticket created: <#${ticketChannel.id}>`,
      ephemeral: true,
    });
  } catch (error) {
    console.error('[Ticket] Error creating ticket:', error);
    await interaction.editReply({ content: '❌ Failed to create ticket. Please check bot permissions.' });
  }
}

export async function handleTicketClose(interaction: any) {
  if (!interaction.guild || !isStaff(interaction.member)) {
    await interaction.editReply({ content: '❌ You do not have permission to close tickets.' });
    return;
  }

  const channel = interaction.channel as TextChannel;
  if (!channel.name.startsWith('ticket-')) {
    await interaction.editReply({ content: '❌ This is not a ticket channel.' });
    return;
  }

  const reason = interaction.options.getString('reason') || 'No reason provided';

  try {
    const embed = new EmbedBuilder()
      .setTitle('🔒 Ticket Closed')
      .setDescription(`This ticket has been closed by ${interaction.user.tag}\n**Reason:** ${reason}`)
      .setColor(0xff0000)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    await channel.send('This ticket will be deleted in 10 seconds...');

    setTimeout(async () => {
      try {
        await channel.delete();
      } catch (error) {
        console.error('[Ticket] Error deleting channel:', error);
      }
    }, 10000);

    await interaction.editReply({ content: '✅ Ticket closed successfully.' });
  } catch (error) {
    console.error('[Ticket] Error closing ticket:', error);
    await interaction.editReply({ content: '❌ Failed to close ticket.' });
  }
}

export async function handleTicketButton(interaction: any) {
  const [action, type, channelId] = interaction.customId.split('_');

  if (action !== 'ticket' || type !== 'close') return;

  if (!isStaff(interaction.member)) {
    await interaction.reply({ content: '❌ You do not have permission to close tickets.', ephemeral: true });
    return;
  }

  const channel = interaction.guild?.channels.cache.get(channelId) as TextChannel;
  if (!channel) {
    await interaction.reply({ content: '❌ Ticket channel not found.', ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('🔒 Ticket Closed')
    .setDescription(`This ticket has been closed by ${interaction.user.tag}`)
    .setColor(0xff0000)
    .setTimestamp();

  await channel.send({ embeds: [embed] });
  await channel.send('This ticket will be deleted in 10 seconds...');

  setTimeout(async () => {
    try {
      await channel.delete();
    } catch (error) {
      console.error('[Ticket] Error deleting channel:', error);
    }
  }, 10000);

  await interaction.reply({ content: '✅ Ticket closed successfully.', ephemeral: true });
}

// Moderation Commands
export async function handleKick(interaction: any) {
  if (!isStaff(interaction.member)) {
    await interaction.editReply({ content: '❌ You do not have permission to kick members.' });
    return;
  }

  const member = interaction.options.getMember('user') as GuildMember;
  const reason = interaction.options.getString('reason') || 'No reason provided';

  if (!member) {
    await interaction.editReply({ content: '❌ User not found.' });
    return;
  }

  if (member.id === interaction.user.id) {
    await interaction.editReply({ content: '❌ You cannot kick yourself.' });
    return;
  }

  if (member.roles.highest.position >= interaction.member.roles.highest.position && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.editReply({ content: '❌ You cannot kick someone with equal or higher roles.' });
    return;
  }

  try {
    await member.kick(reason);
    const embed = new EmbedBuilder()
      .setTitle('👢 Member Kicked')
      .addFields(
        { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
        { name: 'Moderator', value: interaction.user.tag, inline: true },
        { name: 'Reason', value: reason, inline: false }
      )
      .setColor(0xff9900)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[Moderation] Error kicking member:', error);
    await interaction.editReply({ content: '❌ Failed to kick member. Check bot permissions.' });
  }
}

export async function handleBan(interaction: any) {
  if (!isStaff(interaction.member)) {
    await interaction.editReply({ content: '❌ You do not have permission to ban members.' });
    return;
  }

  const user = interaction.options.getUser('user') as User;
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const deleteDays = interaction.options.getInteger('delete_days') || 0;

  if (!user) {
    await interaction.editReply({ content: '❌ User not found.' });
    return;
  }

  const member = interaction.guild?.members.cache.get(user.id);
  if (member) {
    if (member.id === interaction.user.id) {
      await interaction.editReply({ content: '❌ You cannot ban yourself.' });
      return;
    }

    if (member.roles.highest.position >= interaction.member.roles.highest.position && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.editReply({ content: '❌ You cannot ban someone with equal or higher roles.' });
      return;
    }
  }

  try {
    await interaction.guild?.members.ban(user, { reason, deleteMessageDays: deleteDays });
    const embed = new EmbedBuilder()
      .setTitle('🔨 Member Banned')
      .addFields(
        { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
        { name: 'Moderator', value: interaction.user.tag, inline: true },
        { name: 'Reason', value: reason, inline: false },
        { name: 'Messages Deleted', value: `${deleteDays} days`, inline: true }
      )
      .setColor(0xff0000)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[Moderation] Error banning member:', error);
    await interaction.editReply({ content: '❌ Failed to ban member. Check bot permissions.' });
  }
}

export async function handleTimeout(interaction: any) {
  if (!isStaff(interaction.member)) {
    await interaction.editReply({ content: '❌ You do not have permission to timeout members.' });
    return;
  }

  const member = interaction.options.getMember('user') as GuildMember;
  const duration = interaction.options.getInteger('duration') || 60;
  const reason = interaction.options.getString('reason') || 'No reason provided';

  if (!member) {
    await interaction.editReply({ content: '❌ User not found.' });
    return;
  }

  if (member.id === interaction.user.id) {
    await interaction.editReply({ content: '❌ You cannot timeout yourself.' });
    return;
  }

  if (member.roles.highest.position >= interaction.member.roles.highest.position && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.editReply({ content: '❌ You cannot timeout someone with equal or higher roles.' });
    return;
  }

  try {
    await member.timeout(duration * 60 * 1000, reason);

    const embed = new EmbedBuilder()
      .setTitle('⏰ Member Timed Out')
      .addFields(
        { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
        { name: 'Moderator', value: interaction.user.tag, inline: true },
        { name: 'Duration', value: `${duration} minutes`, inline: true },
        { name: 'Reason', value: reason, inline: false }
      )
      .setColor(0xffaa00)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[Moderation] Error timing out member:', error);
    await interaction.editReply({ content: '❌ Failed to timeout member. Check bot permissions.' });
  }
}

export async function handleWarn(interaction: any) {
  if (!isStaff(interaction.member)) {
    await interaction.editReply({ content: '❌ You do not have permission to warn members.' });
    return;
  }

  const member = interaction.options.getMember('user') as GuildMember;
  const reason = interaction.options.getString('reason') || 'No reason provided';

  if (!member) {
    await interaction.editReply({ content: '❌ User not found.' });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('⚠️ Warning Issued')
    .addFields(
      { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
      { name: 'Moderator', value: interaction.user.tag, inline: true },
      { name: 'Reason', value: reason, inline: false }
    )
    .setColor(0xffff00)
    .setTimestamp();

  try {
    await member.send({ embeds: [embed] }).catch(() => {
      // User has DMs disabled, continue anyway
    });
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[Moderation] Error warning member:', error);
    await interaction.editReply({ content: '❌ Failed to warn member.' });
  }
}

// Server Management
export async function handlePurge(interaction: any) {
  if (!isStaff(interaction.member)) {
    await interaction.editReply({ content: '❌ You do not have permission to purge messages.' });
    return;
  }

  const amount = interaction.options.getInteger('amount') || 10;
  const user = interaction.options.getUser('user');

  if (amount < 1 || amount > 100) {
    await interaction.editReply({ content: '❌ Amount must be between 1 and 100.' });
    return;
  }

  const channel = interaction.channel as TextChannel;
  if (!channel) {
    await interaction.editReply({ content: '❌ This command can only be used in text channels.' });
    return;
  }

  try {
    const messages = await channel.messages.fetch({ limit: amount });
    const filtered = user ? messages.filter((msg) => msg.author.id === user.id) : messages;

    if (filtered.size === 0) {
      await interaction.editReply({ content: '❌ No messages found to delete.' });
      return;
    }

    await channel.bulkDelete(filtered, true);
    const embed = new EmbedBuilder()
      .setTitle('🧹 Messages Purged')
      .addFields(
        { name: 'Amount', value: `${filtered.size} messages`, inline: true },
        { name: 'Channel', value: channel.toString(), inline: true },
        { name: 'Moderator', value: interaction.user.tag, inline: true }
      )
      .setColor(0x00ff00)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[Moderation] Error purging messages:', error);
    await interaction.editReply({ content: '❌ Failed to purge messages. Messages may be older than 14 days.' });
  }
}

export async function handleSlowmode(interaction: any) {
  if (!isStaff(interaction.member)) {
    await interaction.editReply({ content: '❌ You do not have permission to set slowmode.' });
    return;
  }

  const seconds = interaction.options.getInteger('seconds') || 0;

  if (seconds < 0 || seconds > 21600) {
    await interaction.editReply({ content: '❌ Slowmode must be between 0 and 21600 seconds (6 hours).' });
    return;
  }

  const channel = interaction.channel as TextChannel;
  if (!channel) {
    await interaction.editReply({ content: '❌ This command can only be used in text channels.' });
    return;
  }

  try {
    await channel.setRateLimitPerUser(seconds);
    const embed = new EmbedBuilder()
      .setTitle('🐌 Slowmode Set')
      .addFields(
        { name: 'Channel', value: channel.toString(), inline: true },
        { name: 'Duration', value: seconds === 0 ? 'Disabled' : `${seconds} seconds`, inline: true },
        { name: 'Moderator', value: interaction.user.tag, inline: true }
      )
      .setColor(0x00ff00)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[Moderation] Error setting slowmode:', error);
    await interaction.editReply({ content: '❌ Failed to set slowmode.' });
  }
}

export async function handleLockChannel(interaction: any) {
  if (!isStaff(interaction.member)) {
    await interaction.editReply({ content: '❌ You do not have permission to lock channels.' });
    return;
  }

  const channel = (interaction.options.getChannel('channel') || interaction.channel) as TextChannel;
  if (!channel) {
    await interaction.editReply({ content: '❌ Channel not found.' });
    return;
  }

  try {
    await channel.permissionOverwrites.edit(interaction.guild!.id, {
      SendMessages: false,
    });

    const embed = new EmbedBuilder()
      .setTitle('🔒 Channel Locked')
      .addFields(
        { name: 'Channel', value: channel.toString(), inline: true },
        { name: 'Moderator', value: interaction.user.tag, inline: true }
      )
      .setColor(0xff0000)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[Moderation] Error locking channel:', error);
    await interaction.editReply({ content: '❌ Failed to lock channel.' });
  }
}

export async function handleUnlockChannel(interaction: any) {
  if (!isStaff(interaction.member)) {
    await interaction.editReply({ content: '❌ You do not have permission to unlock channels.' });
    return;
  }

  const channel = (interaction.options.getChannel('channel') || interaction.channel) as TextChannel;
  if (!channel) {
    await interaction.editReply({ content: '❌ Channel not found.' });
    return;
  }

  try {
    await channel.permissionOverwrites.edit(interaction.guild!.id, {
      SendMessages: null,
    });

    const embed = new EmbedBuilder()
      .setTitle('🔓 Channel Unlocked')
      .addFields(
        { name: 'Channel', value: channel.toString(), inline: true },
        { name: 'Moderator', value: interaction.user.tag, inline: true }
      )
      .setColor(0x00ff00)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[Moderation] Error unlocking channel:', error);
    await interaction.editReply({ content: '❌ Failed to unlock channel.' });
  }
}

// Info Commands
export async function handleUserInfo(interaction: any) {
  const user = interaction.options.getUser('user') || interaction.user;
  const member = interaction.guild?.members.cache.get(user.id);

  const embed = new EmbedBuilder()
    .setTitle(`👤 User Info: ${user.tag}`)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: 'ID', value: user.id, inline: true },
      { name: 'Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
      { name: 'Bot', value: user.bot ? 'Yes' : 'No', inline: true }
    )
    .setColor(0x0099ff)
    .setTimestamp();

  if (member) {
    embed
      .addFields(
        { name: 'Joined Server', value: `<t:${Math.floor(member.joinedTimestamp! / 1000)}:R>`, inline: true },
        { name: 'Roles', value: member.roles.cache.size > 1 ? member.roles.cache.filter((r) => r.id !== interaction.guild!.id).map((r) => r.toString()).join(', ') || 'None' : 'None', inline: false },
        { name: 'Highest Role', value: member.roles.highest.toString(), inline: true }
      )
      .setColor(member.displayColor || 0x0099ff);
  }

  await interaction.editReply({ embeds: [embed] });
}

export async function handleServerInfo(interaction: any) {
  if (!interaction.guild) {
    await interaction.editReply({ content: '❌ This command can only be used in a server.' });
    return;
  }

  const guild = interaction.guild;
  const owner = await guild.fetchOwner();

  const embed = new EmbedBuilder()
    .setTitle(`📊 Server Info: ${guild.name}`)
    .setThumbnail(guild.iconURL())
    .addFields(
      { name: 'Owner', value: owner.user.tag, inline: true },
      { name: 'Members', value: `${guild.memberCount}`, inline: true },
      { name: 'Channels', value: `${guild.channels.cache.size}`, inline: true },
      { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
      { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
      { name: 'Boost Level', value: `${guild.premiumTier}`, inline: true }
    )
    .setColor(0x0099ff)
    .setTimestamp();

  if (guild.description) {
    embed.setDescription(guild.description);
  }

  await interaction.editReply({ embeds: [embed] });
}
