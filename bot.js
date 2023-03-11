require("dotenv").config();
const { Bot, webhookCallback, HttpError, GrammyError } = require("grammy");
const vscoSession = require("vsco-dl")();
const path = require("path");
const url = require("url");

// Bot

const bot = new Bot(process.env.BOT_TOKEN);

/// Response

async function responseTime(ctx, next) {
  const before = Date.now();
  await next();
  const after = Date.now();
  console.log(`Response time: ${after - before} ms`);
}

bot.use(responseTime);

// Commands

bot.command("start", async (ctx) => {
  if (!ctx.chat.type == "private") {
    await bot.api.sendMessage(
      ctx.chat.id,
      "*Channels and groups are not supported presently.*",
      { parse_mode: "Markdown" }
    );
    return;
  }
  await ctx
    .reply(
      "*Welcome!* ✨\n_Send a VSCO username or profile link to get recent posts._",
      {
        parse_mode: "Markdown",
      }
    )
    .then(console.log(`New user added:`, ctx.chat));
});

bot.command("help", async (ctx) => {
  await ctx
    .reply(
      "*@anzubo Project.*\n\n_This bot gets the 10 most recent media posts from a VSCO profile.\nSend a username or profile link to try it out!_",
      { parse_mode: "Markdown" }
    )
    .then(console.log("Help command sent to", ctx.chat.id));
});

// Messages

bot.on("message", async (ctx) => {
  // Logging

  const from = ctx.from;
  const name =
    from.last_name === undefined
      ? from.first_name
      : `${from.first_name} ${from.last_name}`;
  console.log(
    `From: ${name} (@${from.username}) ID: ${from.id}\nMessage: ${ctx.msg.text}`
  );

  // Logic

  const messageText = ctx.message.text;
  const parsedUrl = url.parse(messageText);
  let username;

  if (parsedUrl.protocol && parsedUrl.hostname) {
    if (parsedUrl.hostname === "vsco.co") {
      username = parsedUrl.pathname.split("/")[1];
    } else {
      await ctx.reply("*Send a valid VSCO profile link.*", {
        parse_mode: "Markdown",
        reply_to_message_id: ctx.msg.message_id,
      });
      return;
    }
  } else if (/^[a-zA-Z0-9_-]+$/.test(ctx.msg.text)) {
    username = ctx.message.text;
  } else {
    await ctx.reply("*Send a valid VSCO username.*", {
      parse_mode: "Markdown",
      reply_to_message_id: ctx.msg.message_id,
    });
    return;
  }

  const statusMessage = await ctx.reply(`*Downloading*`, {
    parse_mode: "Markdown",
  });
  async function deleteMessageWithDelay(fromId, messageId, delayMs) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        bot.api
          .deleteMessage(fromId, messageId)
          .then(() => resolve())
          .catch((error) => reject(error));
      }, delayMs);
    });
  }
  await deleteMessageWithDelay(ctx.chat.id, statusMessage.message_id, 3000);

  // Main

  async function getVscoMedia(username, limit) {
    try {
      const media = await vscoSession.getMedia(username, limit);
      const mediaURLs = media.map((e) => "https://" + e);
      const groupedMediaURLs = await chunkArray(mediaURLs, 10); // Split URLs into groups of 10
      const mediaGroups = [];
      for (const mediaGroup of groupedMediaURLs) {
        const mediaGroupItems = await Promise.all(
          mediaGroup.map(async (mediaURL) => {
            const mediaType = await getMediaType(mediaURL);
            if (mediaType === "photo") {
              return {
                type: "photo",
                media: mediaURL,
              };
            } else if (mediaType === "video") {
              return {
                type: "video",
                media: { url: mediaURL },
              };
            } else if (mediaType === "gif") {
              return {
                type: "animation",
                media: mediaURL,
              };
            }
          })
        );
        mediaGroups.push(mediaGroupItems.filter((item) => item !== undefined)); // Remove undefined items (e.g. unsupported media types)
      }
      const mediaItems = mediaGroups.flat(); // Flatten the array of media items
      const groupedMediaItems = await chunkArray(mediaItems, 10); // Split media items into groups of 10
      for (const mediaGroup of groupedMediaItems) {
        await ctx.replyWithMediaGroup(mediaGroup, {
          reply_to_message_id: ctx.msg.message_id,
        });
      }
    } catch (err) {
      console.log(err);
    }
  }

  async function getMediaType(mediaURL) {
    const extension = path.extname(mediaURL);
    if (extension === ".jpg" || extension === ".jpeg" || extension === ".png") {
      return "photo";
    } else if (extension === ".mp4" || extension === ".mov") {
      return "video";
    } else if (extension === ".gif") {
      return "gif";
    } else {
      return undefined;
    }
  }

  async function chunkArray(arr, chunkSize) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += chunkSize) {
      chunks.push(arr.slice(i, i + chunkSize));
    }
    return chunks;
  }

  try {
    const limit = 10;
    await getVscoMedia(username, limit);
  } catch (error) {
    if (error instanceof GrammyError) {
      if (error.message.includes("Forbidden: bot was blocked by the user")) {
        console.log("Bot was blocked by the user");
      } else if (error.message.includes("Call to 'sendMediaGroup' failed!")) {
        console.log("Error sending files. Maybe API limit was hit.");
        await ctx.reply(
          `*Error contacting VSCO or Telegram API limit was hit.*`,
          {
            parse_mode: "Markdown",
            reply_to_message_id: ctx.msg.message_id,
          }
        );
      } else {
        await ctx.reply(`*An error occurred: ${error.message}*`, {
          parse_mode: "Markdown",
          reply_to_message_id: ctx.msg.message_id,
        });
      }
      console.log(`Error sending message: ${error.message}`);
      return;
    } else {
      console.log(`An error occured:`, error);
      await ctx.reply(
        `*An error occurred. Are you sure you sent a valid VSCO username?*\n_Error: ${error.message}_`,
        { parse_mode: "Markdown", reply_to_message_id: ctx.msg.message_id }
      );
      return;
    }
  }
});

// Error

bot.catch((err) => {
  const ctx = err.ctx;
  console.error(
    "Error while handling update",
    ctx.update.update_id,
    "\nQuery:",
    ctx.msg.text
  );
  const e = err.error;
  if (e instanceof GrammyError) {
    console.error("Error in request:", e.description);
    if (e.description === "Forbidden: bot was blocked by the user") {
      console.log("Bot was blocked by the user");
    } else {
      ctx.reply("An error occurred");
    }
  } else if (e instanceof HttpError) {
    console.error("Could not contact Telegram:", e);
  } else {
    console.error("Unknown error:", e);
  }
});

// Run

bot.start();
