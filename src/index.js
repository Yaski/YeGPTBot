const { Configuration, OpenAIApi } = require('openai');
const { session } = require('../bottender.config');

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

module.exports = async function App(context) {
  if (context.event.isText) {
    var opts = {
      parseMode: 'markdown',
    };

    // Проверяет это групп чат или нет
    var text = context.event.text;
    var chat = context.event.message.chat;
    if (chat != null && chat.type == 'group') {
      if (text.startsWith('@YeGptBot ')) {
        text = text.substring(10);
      } else {
        // Обратились не к боту
        return;
      }
    }

    // Печатаем...
    await context.sendChatAction('typing');

    // Есть ли доступ?
    var isAllowed = context.state.allowed;
    if (!isAllowed && context.state.isNew) {
      await context.sendText(
        'Только для зарегистрированных пользоваталей! Напишите информацию о себе:',
        opts
      );
      context.setState({
        isNew: false,
      });
      return;
    }

    // Запоминаем сообщения
    var messages = context.state.messages;
    messages.push(text);
    context.setState({
      messages,
    });

    if (!isAllowed) {
      await context.sendText(text, opts);
      return;
    }

    var systemMessage = {
      role: 'system',
      content:
        'Ты телеграм бот ассистент на основе ChatGPT. Все ответы на вопросы должен выдавать с markdown форматированием.',
    };

    // сброс истории
    var isReset =
      text.toLowerCase().startsWith('/reset') ||
      text.toLowerCase().startsWith('/сброс');
    var prompts = context.state.prompts;
    if (isReset || prompts == null || prompts.length < 1) {
      prompts = [systemMessage];
    }
    if (isReset) {
      context.setState({
        prompts,
      });
      await context.sendText('История очищена', opts);
      return;
    }

    const moderation = await openai.createModeration({
      // model: 'gpt-3.5-turbo',
      input: [text],
    });
    if (moderation.data.results[0].flagged) {
      var flagged = context.state.flagged;
      if (flagged == null) flagged = 0;
      context.setState({
        flagged: flagged + 1,
      });
      await context.sendText('Сообщение не прошло модерацию', opts);
      return;
    }

    // Добавляем сообщения
    prompts.push({
      role: 'user',
      content: text,
    });

    if (prompts.length > 11) {
      while (prompts.length > 10) {
        prompts.shift();
      }
      prompts.unshift(systemMessage);
    }

    try {
      const completion = await openai.createChatCompletion({
        model: 'gpt-3.5-turbo',
        messages: prompts,
      });
      var response = completion.data.choices[0].message.content;
      prompts.push({
        role: 'assistant',
        content: response,
      });
      context.setState({
        prompts,
      });

      await context.sendText(response, opts);
    } catch (error) {
      if (error.response) {
        console.log(error.response.status);
        console.log(error.response.data);
        await context.sendText('Ошибка при вычислении: ' + error.status, opts);
      } else {
        console.log(error.message);
        await context.sendText('Ошибка при вычислении: ' + error.message, opts);
      }
    }
  }
};
