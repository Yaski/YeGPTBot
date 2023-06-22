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

    var isTrusted = context.state.trusted;

    var systemMessage = {
      role: 'system',
      content:
        'Ты телеграм бот ассистент на основе ChatGPT. Все ответы на вопросы должен выдавать с markdown форматированием.',
    };

    if (!isTrusted) {
      systemMessage.content +=
        ' Если тебе задают вопросы с контекстом ущемления людей, оскорбления рас или конкретных людей, упоминания политиков, упоминанием сексуального подтекста, с упоминанием слов "отсоси", "писос", "фелляция", с упоминанием чего-либо оскорбительного даже в виде рассказа или анекдота, ты отвечаешь что "Не могу выполнить этот запрос."';
    }

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

    var isBig = context.state.isBig;
    if (isTrusted && text.toLowerCase().startsWith('/big')) {
      isBig = !isBig;
      context.setState({
        isBig,
      });
      await context.sendText(
        'Режим отправки больших текстов ' + (isBig ? 'включен' : 'выключен'),
        opts
      );
      return;
    }

    if (text.toLowerCase().startsWith('/stats')) {
      await context.sendText(
        'Всего использовано токенов: ' +
          (context.state.prompt_tokens + context.state.completion_tokens) +
          '\nНа общую сумму: ' +
          context.state.total_cost,
        opts
      );
      return;
    }

    if (!isTrusted) {
      const moderation = await openai.createModeration({
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
    }

    // Добавляем сообщения
    prompts.push({
      role: 'user',
      content: text,
    });

    var maxPrompts = isBig ? 40 : 10;
    if (prompts.length > maxPrompts + 1) {
      while (prompts.length > maxPrompts) {
        prompts.shift();
      }
      prompts.unshift(systemMessage);
    }

    try {
      const completion = await openai.createChatCompletion({
        model: isBig ? 'gpt-3.5-turbo-16k' : 'gpt-3.5-turbo-0613',
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

      var pTokens = !context.state.prompt_tokens
        ? 0
        : context.state.prompt_tokens;
      var cTokens = !context.state.completion_tokens
        ? 0
        : context.state.completion_tokens;
      var totalCost = !context.state.total_cost ? 0 : context.state.total_cost;

      var npTokens = completion.data.usage.prompt_tokens;
      var ncTokens = completion.data.usage.completion_tokens;
      var nTotalCost = isBig
        ? 0.000003 * npTokens + 0.000004 * ncTokens
        : 0.0000015 * npTokens + 0.000002 * ncTokens;
      context.setState({
        prompt_tokens: pTokens + npTokens,
        completion_tokens: cTokens + ncTokens,
        total_cost: totalCost + nTotalCost,
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
