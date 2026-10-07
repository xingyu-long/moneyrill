// A small built-in emoji set for category icons: no network, no dependency. Anything else can be typed or
// pasted into the picker's text box (macOS: Ctrl+Cmd+Space, Windows: Win+.).
export type EmojiTab = { id: string; label: string; icon: string; emojis: [string, string][] };

const e = (list: string): [string, string][] =>
  list
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const [emoji, ...words] = x.split(' ');
      return [emoji, words.join(' ')];
    });

export const EMOJI_TABS: EmojiTab[] = [
  {
    id: 'money',
    label: 'Money',
    icon: '💰',
    emojis: e(
      `💰 money bag|💵 dollar cash|💴 yen|💶 euro|💷 pound|💸 money flying spend|💳 credit card|🪙 coin interest|🏦 bank|🧾 receipt bill|📈 chart up stocks growth|📉 chart down|💹 market|🧮 abacus calculator|🪪 id card|📊 bar chart|🤑 rich|🏧 atm|💲 dollar sign|🔁 transfer repeat|🔄 sync|↔️ swap|➡️ buy|⬅️ sell|⚖️ balance|🎯 goal|🐷 savings piggy|📒 ledger`,
    ),
  },
  {
    id: 'food',
    label: 'Food',
    icon: '🍽️',
    emojis: e(
      `🍽️ dining|🥑 groceries avocado|🍔 burger|🍕 pizza|🍣 sushi|🍜 noodles ramen|🌮 taco|🥗 salad|🍞 bread|🥐 croissant bakery|🍳 breakfast|☕ coffee|🍵 tea|🧋 boba|🍺 beer bar|🍷 wine|🍸 cocktail|🍰 cake dessert|🍦 ice cream|🍎 apple fruit|🥦 vegetables|🥩 meat|🛒 shopping cart|🍿 popcorn|🍫 chocolate snack|🥤 soda drink`,
    ),
  },
  {
    id: 'home',
    label: 'Home',
    icon: '🏠',
    emojis: e(
      `🏠 house rent|🏡 mortgage|🏢 office building|🔨 home improvement hammer|🔧 repair wrench|🪛 tools|🛠️ maintenance|💡 utilities light|🔌 electric|🚿 water shower|🔥 gas heat|🌐 internet|📶 wifi|📱 phone|☎️ landline|🛋️ furniture|🛏️ bed|🧹 cleaning|🧺 laundry|🪴 plants garden|🗑️ trash|📦 delivery package|🔑 keys deposit|🏘️ hoa neighborhood|☂️ insurance umbrella|🛡️ protection`,
    ),
  },
  {
    id: 'transport',
    label: 'Transport',
    icon: '🚗',
    emojis: e(
      `🚗 car|🚘 auto payment|🚙 suv|🚕 taxi|🚌 bus transit|🚇 metro subway|🚆 train|🚲 bike|🛴 scooter|⛽ gas fuel|🔋 ev charging battery|🅿️ parking|🛣️ toll road|🚦 traffic|✈️ flight travel|🧳 luggage trip|🚢 cruise ship|🏨 hotel|🏖️ beach vacation|⛺ camping|🗺️ map|🛞 tires`,
    ),
  },
  {
    id: 'shopping',
    label: 'Shopping',
    icon: '🛍️',
    emojis: e(
      `🛍️ shopping bags|👕 clothes|👗 dress|👟 shoes|👜 handbag|💍 jewelry|🧴 personal care|💄 beauty|💇 haircut|🎁 gifts present|📚 books|🖥️ computer|💻 laptop|🎧 headphones|📷 camera|⌚ watch|🧸 toys kids|🍼 baby|🐶 dog pet|🐱 cat pet|🐾 pets|🎀 ribbon|🪑 chair`,
    ),
  },
  {
    id: 'health',
    label: 'Health',
    icon: '🩺',
    emojis: e(
      `🩺 medical doctor|💊 pharmacy medicine|🏥 hospital|🦷 dental|👓 vision glasses|🧘 yoga wellness|🏋️ gym fitness|🏃 running|⚽ sports|🎾 tennis|⛳ golf|🏊 swimming|🚴 cycling|🧠 therapy|💆 spa massage|🩹 first aid|🧬 lab`,
    ),
  },
  {
    id: 'fun',
    label: 'Fun',
    icon: '🎬',
    emojis: e(
      `🎬 movies entertainment|🎮 games|🎵 music|🎧 audio|📺 tv streaming|🎟️ tickets events|🎭 theater|🎨 art hobby|📖 reading|🎲 board games|🎤 karaoke|🎢 theme park|🎓 education school|🧑‍🎓 tuition|💼 work business|🖇️ office supplies|📰 news subscriptions|☁️ cloud storage|⚡ electricity|🎄 holiday|🎂 birthday|💐 flowers`,
    ),
  },
  {
    id: 'work',
    label: 'Work & giving',
    icon: '💼',
    emojis: e(
      `💼 business|🧾 paycheck|🎗️ charity donation|🤝 contribution|🙏 giving|🌱 growth|🌲 401k retirement|🏛️ government taxes|📝 fees|📋 paperwork|🧑‍💻 freelance|🏭 industry|🧑‍🏫 teacher|📬 mail|⚖️ legal|🪖 military|🕊️ nonprofit|❓ uncategorized|❤️ love|⭐ star|🔖 tag|📌 pin|🧩 other`,
    ),
  },
];

/** Every emoji whose name or keywords contain the text. */
export function searchEmojis(text: string) {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const seen = new Set<string>();
  const out: [string, string][] = [];
  for (const tab of EMOJI_TABS)
    for (const [emoji, words] of tab.emojis)
      if (!seen.has(emoji) && words.toLowerCase().includes(q)) {
        seen.add(emoji);
        out.push([emoji, words]);
      }
  return out;
}
