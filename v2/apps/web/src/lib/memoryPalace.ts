// Memory Palace — the 64-square memory system (Set 1: Classic Animals & Objects).
// Each square is assigned a vivid, funny scene built from two mnemonics:
//   • file letter (a–h) → a word starting with that letter   (a = Ant, b = Bear …)
//   • rank number (1–8) → a word that RHYMES with the number  (1 = Sun, 2 = Shoe …)
// So a1 = "Ant + Sun", h8 = "Hedgehog + Ate". The bizarre image makes the
// coordinate impossible to forget (memory-champions' "bizarreness effect").
// Source: chess_memory_system.md (built for Harinitha's chess journey).

export interface Scene {
  pair: string;   // e.g. "Ant + Sun"
  emoji: string;  // kid-friendly visual anchor
  scene: string;  // the vivid one-line story for this square
}

// Files → alliterative animal/word per square.  Ranks → rhyming object.
// Indexed [square] e.g. SCENES["a1"].

const SET1: Record<string, Scene> = {
  // Rank 1 — rhymes with ONE (Sun/Bun/Fun/Run/One/Nun/Gun/Swan)
  a1: { pair: "Ant + Sun",       emoji: "🐜", scene: "A tiny ant in sunglasses tans on the Sun, sipping lemonade. “This tanning bed is HOT!”" },
  b1: { pair: "Bear + Bun",      emoji: "🐻", scene: "A huge bear sits on a giant burger Bun like a throne, napkin tucked in. “I am King of the Bun!”" },
  c1: { pair: "Cat + Fun",       emoji: "🐱", scene: "A cat having the most Fun ever at a party — confetti flying everywhere." },
  d1: { pair: "Dog + Run",       emoji: "🐶", scene: "A dog on a Run, racing so fast its ears flap like wings." },
  e1: { pair: "Elephant + One",  emoji: "🐘", scene: "An elephant balances on One toe like a ballerina, wearing a tutu. “Tada!”" },
  f1: { pair: "Fox + Nun",       emoji: "🦊", scene: "A sly fox dressed as a Nun, tiptoeing out of the kitchen." },
  g1: { pair: "Goat + Gun",      emoji: "🐐", scene: "A goat runs wild with a water Gun, soaking everyone. Maniacal grin." },
  h1: { pair: "Horse + Swan",    emoji: "🐴", scene: "A horse in a Swan costume at a ballet recital — it falls, gracefully." },
  // Rank 2 — rhymes with TWO / Shoe (Zoo/Glue/Stew/Moo/Crew/Chew/Blue/Shoe)
  a2: { pair: "Aeroplane + Zoo", emoji: "✈️", scene: "A paper Aeroplane flies the whole Zoo on a field trip across the sky." },
  b2: { pair: "Banana + Glue",   emoji: "🍌", scene: "A Banana stuck to the floor with Glue — nobody can peel it free." },
  c2: { pair: "Clown + Stew",    emoji: "🤡", scene: "A Clown cooks a bubbling Stew, juggling carrots into the pot." },
  d2: { pair: "Duck + Moo",      emoji: "🦆", scene: "A Duck that forgot how to quack and goes “Moo!” instead." },
  e2: { pair: "Egg + Crew",      emoji: "🥚", scene: "An Egg captain leads a Crew of tiny eggs sailing a kitchen ship." },
  f2: { pair: "Frog + Chew",     emoji: "🐸", scene: "A Frog happily Chews the biggest piece of bubblegum ever." },
  g2: { pair: "Giant + Blue",    emoji: "🧍", scene: "A Giant painted all Blue hides in the sky, pretending to be a cloud." },
  h2: { pair: "Hippo + Shoe",    emoji: "🦛", scene: "A Hippo squeezing into one tiny Shoe — it does not fit at all." },
  // Rank 3 — rhymes with THREE / Tree (Tree/Bee/Key/Sea/Tea/Flea/Ski/Knee)
  a3: { pair: "Angel + Tree",    emoji: "👼", scene: "An Angel perched in a Tree, handing out apples to the birds." },
  b3: { pair: "Butterfly + Bee", emoji: "🦋", scene: "A Butterfly and a Bee racing flower to flower." },
  c3: { pair: "Cuckoo + Key",    emoji: "🐦", scene: "A Cuckoo bird pops out of the clock holding a golden Key." },
  d3: { pair: "Dinosaur + Sea",  emoji: "🦕", scene: "A Dinosaur splashing in the Sea with a snorkel and floaties." },
  e3: { pair: "Eagle + Tea",     emoji: "🦅", scene: "An Eagle sips Tea on a mountain top, pinky feather out." },
  f3: { pair: "Firefly + Flea",  emoji: "✨", scene: "A Firefly and a tiny Flea throw a glowing dance party." },
  g3: { pair: "Gorilla + Ski",   emoji: "🦍", scene: "A Gorilla on Skis zooms down a snowy hill, banana in hand." },
  h3: { pair: "Hawk + Knee",     emoji: "🦅", scene: "A Hawk scraped its Knee and wears a little bandage." },
  // Rank 4 — rhymes with FOUR / Door (Door/Floor/Snore/Roar/More/Store/Pour/Boar)
  a4: { pair: "Alien + Door",    emoji: "👽", scene: "An Alien knocks on a Door, asking to borrow some sugar." },
  b4: { pair: "Butler + Floor",  emoji: "🤵", scene: "A Butler polishes the Floor so shiny he skates right across it." },
  c4: { pair: "Captain + Snore", emoji: "⚓", scene: "A ship Captain Snores so loud the sails puff out." },
  d4: { pair: "Doctor + Roar",   emoji: "🩺", scene: "A Doctor with a stethoscope Roars like a lion. The patient faints." },
  e4: { pair: "Emperor + More",  emoji: "👑", scene: "An Emperor shouts “More cake!” at a giant feast." },
  f4: { pair: "Farmer + Store",  emoji: "👨‍🌾", scene: "A Farmer opens a Store that only sells giant vegetables." },
  g4: { pair: "Gardener + Pour", emoji: "🌱", scene: "A Gardener Pours water from a little cloud onto happy flowers." },
  h4: { pair: "Hunter + Boar",   emoji: "🏹", scene: "A Hunter is chased by a friendly Boar that just wants a hug." },
  // Rank 5 — rhymes with FIVE / Hive (Hive/Dive/Five/Drive/Alive/Jive/Thrive/Chive)
  a5: { pair: "Acrobat + Hive",  emoji: "🤸", scene: "An Acrobat does flips around a buzzing bee Hive." },
  b5: { pair: "Bee + Dive",      emoji: "🐝", scene: "A Bee in a swimsuit does a perfect Dive into the honey. 10/10!" },
  c5: { pair: "Crab + Five",     emoji: "🦀", scene: "A Crab gives high-Fives with both claws — fish get launched." },
  d5: { pair: "Drum + Drive",    emoji: "🥁", scene: "A Drum rolls along on a Drive, beating its own rhythm." },
  e5: { pair: "Eskimo + Alive",  emoji: "🧊", scene: "An Eskimo's snowman comes Alive and asks for a warm scarf." },
  f5: { pair: "Flamingo + Jive", emoji: "🦩", scene: "A Flamingo dances the Jive balanced on one pink leg." },
  g5: { pair: "Grasshopper + Thrive", emoji: "🦗", scene: "A Grasshopper's garden Thrives as it hops about watering it." },
  h5: { pair: "Hen + Chive",     emoji: "🐔", scene: "A Hen tends neat rows of Chives, clucking proudly." },
  // Rank 6 — rhymes with SIX / Sticks (Sticks/Bricks/Chicks/Kicks/Fix/Tricks/Mix/Licks)
  a6: { pair: "Alligator + Sticks", emoji: "🐊", scene: "An Alligator builds a fort out of Sticks." },
  b6: { pair: "Broomstick + Bricks", emoji: "🧹", scene: "A Broomstick sweeps a tower of Bricks into a castle." },
  c6: { pair: "Carpenter + Chicks", emoji: "🔨", scene: "A Carpenter builds tiny houses for fluffy Chicks." },
  d6: { pair: "Dancer + Kicks",  emoji: "💃", scene: "A Dancer does high Kicks that reach the ceiling." },
  e6: { pair: "Engineer + Fix",  emoji: "🔧", scene: "An Engineer tries to Fix a robot that keeps hiccuping." },
  f6: { pair: "Fisherman + Tricks", emoji: "🎣", scene: "A Fisherman teaches a fish silly Tricks." },
  g6: { pair: "Ghost + Mix",     emoji: "👻", scene: "A Ghost bakes, Mixing a bowl that floats in mid-air." },
  h6: { pair: "Helicopter + Licks", emoji: "🚁", scene: "A Helicopter with a tongue gives the clouds Licks." },
  // Rank 7 — rhymes with SEVEN / Heaven (Heaven/Eleven/Leaven/7-Heads/Heaven/7-Seas/7-Dwarfs/7th-Sky)
  a7: { pair: "Astronaut + Heaven", emoji: "👨‍🚀", scene: "An Astronaut floats up in Heaven, bouncing from cloud to cloud." },
  b7: { pair: "Bird + Eleven",   emoji: "🐦", scene: "A Bird lays exactly Eleven eggs and counts them proudly." },
  c7: { pair: "Cow + Leaven",    emoji: "🐮", scene: "A Cow bakes bread and watches the dough rise (Leaven) huge." },
  d7: { pair: "Dragon + 7 Heads", emoji: "🐉", scene: "A Dragon with Seven Heads, each one arguing about dinner." },
  e7: { pair: "Echo + Heaven",   emoji: "🗣️", scene: "A shout “HELLO!” Echoes forever through Heaven. Angels get headaches." },
  f7: { pair: "Fairy + 7 Seas",  emoji: "🧚", scene: "A Fairy sprinkles stardust over the Seven Seas." },
  g7: { pair: "Goose + 7 Dwarfs", emoji: "🦢", scene: "A Goose leads the Seven Dwarfs home, honking the marching tune." },
  h7: { pair: "Hero + 7th Sky",  emoji: "🦸", scene: "A Hero with a “7” on its chest flies in the highest Sky, fighting cloud-villains." },
  // Rank 8 — rhymes with EIGHT / Gate-Ate (Gate/Plate/Late/Crate/Skate/Weight/Great/Ate)
  a8: { pair: "Anchor + Gate",   emoji: "⚓", scene: "An Anchor holds open a giant Gate so ships can sail through." },
  b8: { pair: "Buffalo + Plate", emoji: "🐃", scene: "A 2000-pound Buffalo eats from a giant Plate, napkin tucked, pinky hoof out. “Pass the salt.”" },
  c8: { pair: "Castle + Late",   emoji: "🏰", scene: "A Castle running Late hops on its towers to catch the bus." },
  d8: { pair: "Dolphin + Crate", emoji: "🐬", scene: "A Dolphin leaps out of a Crate of fish at the market." },
  e8: { pair: "Elf + Skate",     emoji: "🧝", scene: "An Elf Skates across an icy lake, leaving sparkle trails." },
  f8: { pair: "Football + Weight", emoji: "🏈", scene: "A Football lifts Weights at the gym to get extra bouncy." },
  g8: { pair: "Genie + Great",   emoji: "🧞", scene: "A Genie grants the wish to be Great — and crowns everyone." },
  h8: { pair: "Hedgehog + Ate",  emoji: "🦔", scene: "A Hedgehog that Ate too many berries rolls home, happily full." },
};

// ---- EASY (Base System): just 8 file-animals x 8 rank-objects (16 things to learn) ----
const EASY_ANIMALS: Record<string, [string, string]> = {
  a: ["Ant", "\ud83d\udc1c"], b: ["Bear", "\ud83d\udc3b"], c: ["Cat", "\ud83d\udc31"], d: ["Dog", "\ud83d\udc36"],
  e: ["Elephant", "\ud83d\udc18"], f: ["Fox", "\ud83e\udd8a"], g: ["Goat", "\ud83d\udc10"], h: ["Horse", "\ud83d\udc34"],
};
const EASY_OBJECTS: Record<number, string> = { 1: "Sun", 2: "Shoe", 3: "Tree", 4: "Door", 5: "Hive", 6: "Sticks", 7: "Heaven", 8: "Gate" };
const EASY_EMOJI: Record<number, string> = { 1: "\u2600\ufe0f", 2: "\ud83d\udc5f", 3: "\ud83c\udf33", 4: "\ud83d\udeaa", 5: "\ud83c\udf6f", 6: "\ud83e\udeb5", 7: "\u2601\ufe0f", 8: "\ud83d\udeaa" };
const EASY: Record<string, Scene> = (() => {
  const out: Record<string, Scene> = {};
  for (const f of "abcdefgh") for (let r = 1; r <= 8; r++) {
    const [animal, emoji] = EASY_ANIMALS[f]!;
    const obj = EASY_OBJECTS[r]!;
    out[f + r] = { pair: `${animal} + ${obj}`, emoji, scene: `Picture the ${animal} with the ${obj}. Say it out loud: \u201c${animal}\u2026 ${obj}!\u201d` };
  }
  return out;
})();

const SET2: Record<string, Scene> = {
  a1: { pair: "Arjuna + Ton", emoji: "🏋️", scene: "Arjuna lifts a Ton of arrows in one hand and shoots them all at once at the demon army!" },
  a2: { pair: "Agni + Bamboo", emoji: "🔥", scene: "Agni the fire god sneezes and a whole grove of Bamboo bursts into cheerful flames!" },
  a3: { pair: "Ashoka + Fee", emoji: "🪙", scene: "Ashoka pays a golden Fee at the temple gate and every stone lion nods thank-you!" },
  a4: { pair: "Anjaneya + Chore", emoji: "🧹", scene: "Anjaneya finishes every Chore in the temple with one swish of his mighty tail!" },
  a5: { pair: "Aditi + Hive", emoji: "🍯", scene: "Aditi the sky goddess pokes a Hive and a hundred bees tickle her nose!" },
  a6: { pair: "Ashwatthama + Fix", emoji: "🔧", scene: "Ashwatthama can Fix any broken bow with just a snap of his glowing fingers!" },
  a7: { pair: "Airavata + Heaven", emoji: "🐘", scene: "Airavata the giant elephant floats up to Heaven on fluffy white clouds!" },
  a8: { pair: "Apsara + Bait", emoji: "🎣", scene: "An Apsara dances on the water and every fish jumps up to grab her sparkling Bait!" },
  b1: { pair: "Bhima + Done", emoji: "✅", scene: "Bhima gobbles a whole feast in one bite and shouts 'Done!' while the cook is still cooking!" },
  b2: { pair: "Brahma + Kangaroo", emoji: "🦘", scene: "Brahma rides a Kangaroo and all four of his heads bounce in different directions!" },
  b3: { pair: "Bali + Ghee", emoji: "🧈", scene: "Bali the mighty king pours golden Ghee that lights up the whole royal court!" },
  b4: { pair: "Brihaspati + Sore", emoji: "📚", scene: "Brihaspati reads so many books his elbows go Sore and he needs a divine massage!" },
  b5: { pair: "Barbarika + Dive", emoji: "🎯", scene: "Barbarika does a perfect Dive into a river with all three of his magic arrows!" },
  b6: { pair: "Budha + Nix", emoji: "🚫", scene: "Budha the planet god shouts 'Nix!' and every demon plan fizzles into dust!" },
  b7: { pair: "Bhishma + Eleven", emoji: "🏹", scene: "Bhishma scores Eleven bullseyes in a row without even looking at the target!" },
  b8: { pair: "Balarama + Fate", emoji: "🌾", scene: "Balarama plows a straight furrow and writes everyone's Fate right into the field!" },
  c1: { pair: "Chitragupta + None", emoji: "0️⃣", scene: "Chitragupta searches for one good deed and finds None — the demon has to start life over!" },
  c2: { pair: "Chandra + Cockatoo", emoji: "🦜", scene: "Chandra the moon god wakes up a chatty Cockatoo who talks the whole night sky to sleep!" },
  c3: { pair: "Chitrasena + Pea", emoji: "🫛", scene: "Chitrasena's flute music makes a tiny Pea grow into a beanstalk in one second!" },
  c4: { pair: "Chamundi + Bore", emoji: "🦁", scene: "Chamundi's fierce yawn is so Boring even the demons fall asleep mid-attack!" },
  c5: { pair: "Chyavana + Five", emoji: "✨", scene: "Chyavana the sage counts Five magic berries and pops them all in his mouth at once!" },
  c6: { pair: "Chakra + Ticks", emoji: "⏰", scene: "Vishnu's spinning Chakra Ticks like a giant clock as it flies through the sky!" },
  c7: { pair: "Chitraka + Leaven", emoji: "🐎", scene: "Chitraka the magical horse eats Leaven bread and bounces up to the treetops!" },
  c8: { pair: "Chandika + Freight", emoji: "🚂", scene: "Chandika loads a whole demon army into a Freight train and rolls it out of the kingdom!" },
  d1: { pair: "Drona + Won", emoji: "🏆", scene: "Drona hands the trophy to the student who Won by shooting an eye off a wooden fish!" },
  d2: { pair: "Draupadi + Peekaboo", emoji: "🙈", scene: "Draupadi's magic bowl plays Peekaboo — each time she opens it, a new feast appears!" },
  d3: { pair: "Durvasa + Chimpanzee", emoji: "🐒", scene: "Durvasa curses a chattering Chimpanzee who then hides in a tree and never speaks again!" },
  d4: { pair: "Dhruva + Adore", emoji: "⭐", scene: "Little Dhruva sits so still even the stars come down to Adore him from close up!" },
  d5: { pair: "Dadhichi + Drive", emoji: "🦴", scene: "Dadhichi gives his bones and the gods use them to Drive the demon car into the lake!" },
  d6: { pair: "Daksha + Wicks", emoji: "🕯️", scene: "Daksha lights sixty candle Wicks all at once with one furious sneeze!" },
  d7: { pair: "Dhanvantari + Oven", emoji: "🍞", scene: "Dhanvantari brews healing bread in a golden Oven that never lets anyone get sick!" },
  d8: { pair: "Devayani + State", emoji: "🏛️", scene: "Devayani insists on an entire State of flowers before she'll pack for the gods!" },
  e1: { pair: "Ekalavya + Spun", emoji: "🌀", scene: "Ekalavya's magic arrow Spun so fast it drilled a hole right through a mountain!" },
  e2: { pair: "Ekadanta + Tattoo", emoji: "🖋️", scene: "Ekadanta Ganesha shows off a new Tattoo of a mouse riding an elephant on his big trunk!" },
  e3: { pair: "Ekavira + Manatee", emoji: "🐋", scene: "Ekavira rides a friendly Manatee across the river to reach the battle in time!" },
  e4: { pair: "Ekapada + Encore", emoji: "🎤", scene: "Ekapada hops on one foot and every crowd shouts 'Encore!' until he does it again!" },
  e5: { pair: "Ekanetra + Alive", emoji: "👁️", scene: "Ekanetra's one giant eye blinks and every sleeping flower wakes up Alive!" },
  e6: { pair: "Ekaaksha + Picks", emoji: "⛏️", scene: "Ekaaksha the one-eyed giant Picks up a whole mountain like it's a marble!" },
  e7: { pair: "Ekashringa + Given", emoji: "🦄", scene: "Ekashringa the one-horned deer has never been Given a gift he can't magically double!" },
  e8: { pair: "Elai + Skate", emoji: "🌿", scene: "The little sage Elai puts leaves on his feet and Skate-slides down the snowy mountain!" },
  f1: { pair: "Fulara + Stun", emoji: "😲", scene: "Fulara the flower goddess is so pretty she Stuns even Indra into speechless awe!" },
  f2: { pair: "Falguni + Taboo", emoji: "🚫", scene: "Falguni Arjuna sings a song so sacred it's Taboo and every demon covers its ears!" },
  f3: { pair: "Feroksha + Honeybee", emoji: "🐝", scene: "The tiny demon Feroksha is chased away by one buzzing Honeybee and runs home crying!" },
  f4: { pair: "Falgu + Score", emoji: "🎼", scene: "The river Falgu hums a heavenly Score that turns every fish into a tiny choir!" },
  f5: { pair: "Falashruti + Jive", emoji: "📜", scene: "Falashruti the sacred text starts to Jive and all the holy words dance off the page!" },
  f6: { pair: "Faraka + Six", emoji: "6️⃣", scene: "The demon Faraka can only count to Six before his fingers get all confused!" },
  f7: { pair: "Fani + Coven", emoji: "🐍", scene: "Fani the serpent slithers through a Coven of witches and turns them all into good fairies!" },
  f8: { pair: "Falindra + Slate", emoji: "🪨", scene: "Falindra lifts a huge Slate and the gods carve tomorrow's news right on top of it!" },
  g1: { pair: "Ganesha + Pun", emoji: "😂", scene: "Ganesha tells a Pun so bad his little mouse falls off the throne giggling!" },
  g2: { pair: "Garuda + Kazoo", emoji: "🎺", scene: "Garuda flies past every mountain playing a golden Kazoo that echoes for a thousand miles!" },
  g3: { pair: "Gandharva + Bumblebee", emoji: "🐝", scene: "A Gandharva plays flute and every Bumblebee in the meadow dances in perfect rhythm!" },
  g4: { pair: "Gayatri + War", emoji: "🙏", scene: "Goddess Gayatri starts to chant and every War in the world pauses to listen!" },
  g5: { pair: "Ghatotkacha + Thrive", emoji: "👹", scene: "Giant Ghatotkacha plants a tiny seed and watches it Thrive into a tree as tall as him!" },
  g6: { pair: "Govinda + Mix", emoji: "🧈", scene: "Govinda Krishna stirs a Mix of butter and every cow gets a squirt on her nose!" },
  g7: { pair: "Guha + Riven", emoji: "🚣", scene: "Guha the ferryman rows so hard his oar leaves the river Riven right down the middle!" },
  g8: { pair: "Gauri + Grate", emoji: "🌸", scene: "Gauri smiles so warmly the icy Grate melts and flowers bloom through every hole!" },
  h1: { pair: "Hanuman + Shun", emoji: "🙅", scene: "Hanuman Shuns all of Ravana's fancy gifts and flies home with his tail held high!" },
  h2: { pair: "Hiranyakashipu + Shampoo", emoji: "👹", scene: "Hiranyakashipu slips on a puddle of Shampoo just as little Prahlada laughs at him!" },
  h3: { pair: "Hayagriva + Referee", emoji: "👨‍⚖️", scene: "Hayagriva the horse-headed god blows a whistle like a Referee and breaks up a demon fight!" },
  h4: { pair: "Hansa + Tore", emoji: "🦢", scene: "The divine Hansa swan Tore straight through a dark cloud and sunshine poured out!" },
  h5: { pair: "Himavat + Chive", emoji: "🏔️", scene: "Mountain king Himavat grows a giant Chive on his snowy peak and uses it as a flag!" },
  h6: { pair: "Hidimba + Styx", emoji: "🌊", scene: "Hidimba the forest friend guides lost souls across the river Styx with a warm smile!" },
  h7: { pair: "Hari + Driven", emoji: "💙", scene: "Hari Vishnu is Driven around the cosmos by Garuda in the fanciest golden chariot ever!" },
  h8: { pair: "Haladhara + Mate", emoji: "🌾", scene: "Haladhara Balarama finds his best Mate in the fields and they plow smiling side by side!" },
};

const SET3: Record<string, Scene> = {
  a1: { pair: "Apple + Onion", emoji: "🧅", scene: "An Apple rolls into a mountain of Onions and cries happy tears down its shiny red cheeks!" },
  a2: { pair: "Avocado + Cuckoo", emoji: "🐦", scene: "An Avocado hops out of a Cuckoo clock every hour shouting 'toast!' at the whole kitchen!" },
  a3: { pair: "Almond + Wee", emoji: "🌰", scene: "An Almond gives a Wee little sneeze and its brown shell pops off like a party hat!" },
  a4: { pair: "Asparagus + Core", emoji: "🥦", scene: "A giant Asparagus stalk stands proudly at the Core of every stir-fry pan on Earth!" },
  a5: { pair: "Artichoke + Hive", emoji: "🌿", scene: "An artichoke crashes into a Hive and bees decorate it with honey drizzle!" },
  a6: { pair: "Apricot + Fix", emoji: "🍑", scene: "A bouncy Apricot tries to Fix the broken jam jar by squishing itself inside the crack!" },
  a7: { pair: "Anchovy + Heaven", emoji: "🐟", scene: "A tiny anchovy floats up to Heaven and sprinkles itself onto a giant pizza cloud!" },
  a8: { pair: "Aubergine + Bait", emoji: "🍆", scene: "A purple Aubergine uses itself as Bait and every hungry pot gapes wide open to catch it!" },
  b1: { pair: "Banana + Salmon", emoji: "🐟", scene: "A Banana lies on a plate of Salmon pretending to be sushi wrapped in a yellow peel!" },
  b2: { pair: "Bagel + Voodoo", emoji: "🥯", scene: "A Bagel does spooky Voodoo dance and every donut in the box starts wiggling in sync!" },
  b3: { pair: "Broccoli + Plea", emoji: "🥦", scene: "A little Broccoli makes a Plea to the chef please please don't overcook me today!" },
  b4: { pair: "Butter + Explore", emoji: "🧈", scene: "A stick of Butter slides across the counter to Explore every cranny of the toaster!" },
  b5: { pair: "Beet + Dive", emoji: "🫚", scene: "A red beet does a belly Dive into a bowl of soup and splashes everyone at the table!" },
  b6: { pair: "Biscuit + Mix", emoji: "🍪", scene: "A hard Biscuit hops into a Mix and turns the whole batter into a crunchy cookie surprise!" },
  b7: { pair: "Blueberry + Eleven", emoji: "🫐", scene: "Exactly Eleven blueberries roll off the counter and hide under the fridge in a row!" },
  b8: { pair: "Bean + Fate", emoji: "🫘", scene: "A single Bean rolls onto the chef's cutting board — its Fate is a big pot of chili!" },
  c1: { pair: "Carrot + Dragon", emoji: "🥕", scene: "A Carrot rides a tiny orange Dragon that breathes carrot-cake smoke over every pastry!" },
  c2: { pair: "Cabbage + Guru", emoji: "🥬", scene: "A wise Cabbage sits like a Guru on a mountain and teaches the sprouts to meditate!" },
  c3: { pair: "Cashew + Spree", emoji: "🌰", scene: "A Cashew goes on a shopping Spree at the snack aisle and comes home with everything!" },
  c4: { pair: "Celery + Restore", emoji: "🥬", scene: "A Celery stalk drops into water and starts to Restore itself back to crunchy freshness!" },
  c5: { pair: "Cheese + Five", emoji: "🧀", scene: "A wedge of cheese gives a high Five to every mouse who runs through the kitchen tonight!" },
  c6: { pair: "Cherry + Kicks", emoji: "🍒", scene: "A Cherry Kicks its stem off and doorbell-rings the pie shell asking to jump inside!" },
  c7: { pair: "Cinnamon + Leaven", emoji: "🧂", scene: "A cinnamon roll puffs up with Leaven until it is bigger than the oven and floats away!" },
  c8: { pair: "Cucumber + Freight", emoji: "🥒", scene: "A Cucumber loads itself onto a Freight train and rolls straight to the salad express!" },
  d1: { pair: "Doughnut + Cannon", emoji: "🍩", scene: "A Doughnut fires from a Cannon and splats icing rings across the whole ceiling!" },
  d2: { pair: "Dumpling + Menu", emoji: "🥟", scene: "A Dumpling steams open and every dish on the Menu comes tumbling out one by one!" },
  d3: { pair: "Date + Glee", emoji: "🌴", scene: "A sticky Date squeals with Glee as it slides straight into the palm-sugar cake!" },
  d4: { pair: "Dragonfruit + Ignore", emoji: "🐉", scene: "A Dragonfruit tries to Ignore every knife but its bright pink skin gives it away!" },
  d5: { pair: "Daikon + Drive", emoji: "🥕", scene: "A white daikon buckles up and goes for a Drive through the veggie drawer honking!" },
  d6: { pair: "Dulce + Sticks", emoji: "🍬", scene: "A block of Dulce de leche melts around some Sticks and every kid runs over with a grin!" },
  d7: { pair: "Durian + Heaven", emoji: "🌵", scene: "A spiky durian floats up to Heaven and every angel plugs its nose politely!" },
  d8: { pair: "Dill + State", emoji: "🌿", scene: "A bunch of Dill declares a whole State inside a pickle jar with tiny tangy flags!" },
  e1: { pair: "Egg + Wagon", emoji: "🥚", scene: "An Egg loads itself into a Wagon and rolls off to the omelette parade cheering!" },
  e2: { pair: "Edamame + Igloo", emoji: "🫛", scene: "An Edamame pod builds a tiny Igloo out of frozen pea shells and moves in for winter!" },
  e3: { pair: "Éclair + Jubilee", emoji: "🍫", scene: "A chocolate Éclair leads a golden Jubilee parade through the dessert shop windows!" },
  e4: { pair: "Endive + Yore", emoji: "🥬", scene: "A curly Endive tells stories of Yore when salads ruled every royal banquet table!" },
  e5: { pair: "Espresso + Alive", emoji: "☕", scene: "A tiny espresso cup wakes everything Alive by buzzing around the room super fast!" },
  e6: { pair: "Enchilada + Chicks", emoji: "🌯", scene: "A rolled Enchilada opens and out pop six baby Chicks all wearing tiny sombreros!" },
  e7: { pair: "Elderberry + Eleven", emoji: "🫐", scene: "Exactly Eleven Elderberries pop out of a jam jar and dance a purple line-up!" },
  e8: { pair: "Empanada + Slate", emoji: "🥟", scene: "A golden Empanada wipes the Slate clean by eating every crumb on the counter!" },
  f1: { pair: "Fig + Melon", emoji: "🍇", scene: "A plump Fig climbs into a hollow Melon and turns it into a fruit-disco ball!" },
  f2: { pair: "Falafel + Vindaloo", emoji: "🧆", scene: "A round Falafel rolls straight into a bowl of spicy Vindaloo and comes out breathing fire!" },
  f3: { pair: "Fennel + Jamboree", emoji: "🌿", scene: "A frilly Fennel throws a huge herb-garden Jamboree and every leaf comes dancing!" },
  f4: { pair: "Focaccia + Fore", emoji: "🍞", scene: "A dimply Focaccia shouts 'Fore!' as it flies off the pizza paddle onto the lawn!" },
  f5: { pair: "Frankfurter + Jive", emoji: "🌭", scene: "A frankfurter does the Jive in the frying pan and kicks sizzling oil onto the ceiling!" },
  f6: { pair: "Frittata + Tricks", emoji: "🍳", scene: "A Frittata learns circus Tricks and flips itself spinning before landing perfectly flat!" },
  f7: { pair: "Freekeh + Heaven", emoji: "🌾", scene: "A grain of Freekeh sails up to Heaven in a thimble boat hunting the world's biggest soup!" },
  f8: { pair: "Frosting + Mate", emoji: "🎂", scene: "A blob of Frosting finds its true Mate on a cupcake and they swirl together forever!" },
  g1: { pair: "Garlic + Lemon", emoji: "🧄", scene: "A Garlic clove teams up with a Lemon and every vampire flees the salad in tears!" },
  g2: { pair: "Grape + Fondue", emoji: "🍇", scene: "A Grape cannonballs into a Fondue pot and splashes warm chocolate on every strawberry!" },
  g3: { pair: "Ginger + Employee", emoji: "🫚", scene: "A Ginger root becomes Employee of the Month for spicing every dish with one snap!" },
  g4: { pair: "Guava + Gore", emoji: "🍈", scene: "A round Guava splits open with a bit of red Gore that turns out to be just juicy pulp!" },
  g5: { pair: "Granola + Thrive", emoji: "🌾", scene: "A granola cluster plants itself in yogurt and starts to Thrive, growing crunchier each day!" },
  g6: { pair: "Grapefruit + Licks", emoji: "🍊", scene: "A Grapefruit Licks the sugar bowl and its sour face turns into the biggest sweet smile!" },
  g7: { pair: "Gouda + Given", emoji: "🧀", scene: "A wheel of Gouda has Given itself away to every mouse in the pantry as free breakfast!" },
  g8: { pair: "Gnocchi + Skate", emoji: "🥟", scene: "A tiny Gnocchi pillow puts on Skates and does a perfect figure-eight on the pasta dish!" },
  h1: { pair: "Honey + Weapon", emoji: "🍯", scene: "A jar of Honey becomes a sticky Weapon and traps every ant in golden goo!" },
  h2: { pair: "Hotdog + Kazoo", emoji: "🌭", scene: "A Hotdog toots a Kazoo tune from inside its bun and the whole plate hums along!" },
  h3: { pair: "Hummus + Chickadee", emoji: "🫙", scene: "A bowl of Hummus is guarded by a tiny Chickadee who won't let anyone dip without asking!" },
  h4: { pair: "Hazelnut + Oar", emoji: "🌰", scene: "A Hazelnut hops into a walnut-shell boat and rows away with a toothpick for an Oar!" },
  h5: { pair: "Halloumi + Chive", emoji: "🧀", scene: "A squeaky Halloumi slice grows a long Chive mustache and admires itself in the frying pan!" },
  h6: { pair: "Hoisin + Bricks", emoji: "🫙", scene: "A bottle of Hoisin sauce builds sticky Bricks and glues an entire dumpling castle together!" },
  h7: { pair: "Herring + Coven", emoji: "🐟", scene: "A pickled Herring joins a witch's Coven and turns the cauldron into a fishy stew!" },
  h8: { pair: "Hash Brown + Grate", emoji: "🥔", scene: "A crispy Hash Brown slides through the Grate and comes out crunchier than ever!" },
};

const SET4: Record<string, Scene> = {
  a1: { pair: "Astronaut + Marathon", emoji: "🏃", scene: "An Astronaut runs a Marathon in zero gravity and finishes the race a whole day early!" },
  a2: { pair: "Alien + Zulu", emoji: "👽", scene: "A googly-eyed Alien greets Earth in perfect Zulu and everyone cheers!" },
  a3: { pair: "Asteroid + Absentee", emoji: "☄️", scene: "A giant Asteroid is the Absentee at every planet's birthday but always sends stardust gifts!" },
  a4: { pair: "Apollo + Dinosaur", emoji: "🚀", scene: "The Apollo rocket lands near a friendly Dinosaur and gives it a ride to the moon!" },
  a5: { pair: "Antimatter + Hive", emoji: "💥", scene: "Antimatter touches a beehive and poof — the bees vanish into sparkles!" },
  a6: { pair: "Atmosphere + Fix", emoji: "🌌", scene: "The Atmosphere gets a leak and every astronaut runs up to Fix it with sky-blue tape!" },
  a7: { pair: "Andromeda + Heaven", emoji: "🌠", scene: "The Andromeda galaxy floats up to Heaven and knocks on the cloud door!" },
  a8: { pair: "Antares + Rate", emoji: "⭐", scene: "The giant red star Antares glows at a Rate faster than every other star in the sky!" },
  b1: { pair: "Blackhole + Skeleton", emoji: "🕳️", scene: "A Blackhole swallows a Skeleton and burps out a hundred rattling bones across the galaxy!" },
  b2: { pair: "Blastoff + Cashew", emoji: "🚀", scene: "A rocket Blasts off shaped like a giant Cashew and every squirrel goes wild watching!" },
  b3: { pair: "Booster + Guarantee", emoji: "🐝", scene: "A rocket Booster carries a Guarantee that every passenger arrives safely with a smile!" },
  b4: { pair: "Bigbang + Corridor", emoji: "💥", scene: "The Big Bang happened at the end of a long Corridor and knocked open every star's door!" },
  b5: { pair: "Bugbot + Dive", emoji: "🤖", scene: "A tiny space bug robot does a belly Dive into a moon puddle and splashes stars!" },
  b6: { pair: "Beacon + Mix", emoji: "🔦", scene: "A space Beacon spins its rainbow lights and Mixes every color into a cosmic disco!" },
  b7: { pair: "Bytestar + Eleven", emoji: "💫", scene: "Bytestar the robot counts to Eleven but keeps floating away before he finishes!" },
  b8: { pair: "Borealis + Date", emoji: "🌈", scene: "The Northern Borealis lights show up right on their Date and paint the whole sky green!" },
  c1: { pair: "Comet + Cauldron", emoji: "☄️", scene: "A Comet dives into a witch's Cauldron and comes out sparkling with midnight potion!" },
  c2: { pair: "Cosmonaut + Kudzu", emoji: "👨‍🚀", scene: "A Cosmonaut lands in a jungle of Kudzu vines and swings through space like Tarzan!" },
  c3: { pair: "Crater + Trainee", emoji: "🌑", scene: "A moon Crater teaches every Trainee astronaut how to bounce landing perfectly first try!" },
  c4: { pair: "Capsule + Meteor", emoji: "🛸", scene: "The space Capsule high-fives a passing Meteor and both leave sparkle streaks behind!" },
  c5: { pair: "Constellation + Five", emoji: "⭐", scene: "A Constellation shaped like a hand gives a high Five to every passing spaceship!" },
  c6: { pair: "Craterbot + Chicks", emoji: "🤖", scene: "A Crater robot hatches five fluffy Chicks from moon eggs and does a happy dance!" },
  c7: { pair: "Cybermoon + Leaven", emoji: "🌕", scene: "The cyber moon uses Leaven to make the fluffiest moon bread in the whole galaxy!" },
  c8: { pair: "Corona + Crate", emoji: "🌟", scene: "The sun's Corona ships fresh sunlight in a golden Crate to every dark corner of space!" },
  d1: { pair: "Droid + Baron", emoji: "🤖", scene: "A Droid dresses up as a Baron and demands every rocket bow before it takes off!" },
  d2: { pair: "Darkstar + Impromptu", emoji: "⭐", scene: "A Dark star performs an Impromptu song and every planet has to dance the rest of the night!" },
  d3: { pair: "Debris + Devotee", emoji: "🌊", scene: "Every piece of space Debris is a Devotee of the vacuum cleaner satellite that swoops by!" },
  d4: { pair: "Dwarf-planet + Metaphor", emoji: "🪐", scene: "A Dwarf planet is a Metaphor for a marble — small but full of secret worlds inside!" },
  d5: { pair: "Dustcloud + Drive", emoji: "☁️", scene: "A fluffy Dust cloud sits in the driver's seat and takes a rocket for a Drive!" },
  d6: { pair: "Darkmatter + Ticks", emoji: "💥", scene: "Dark matter Ticks like a spooky clock in the deepest black corners of space!" },
  d7: { pair: "Deepspace + Given", emoji: "👾", scene: "Deep space has Given every planet a bright shiny star just for company at night!" },
  d8: { pair: "Docking-port + Debate", emoji: "🛸", scene: "The Docking port hosts a Debate over which rocket parks first and everyone cheers loudly!" },
  e1: { pair: "Eclipse + Falcon", emoji: "🌑", scene: "The Eclipse hides behind a giant space Falcon and only its glowing edge peeks out!" },
  e2: { pair: "Exoplanet + Cockapoo", emoji: "🪐", scene: "An Exoplanet is home to nothing but Cockapoo puppies who all bark at Earth!" },
  e3: { pair: "Earthling + Nominee", emoji: "🌍", scene: "An Earthling is the Nominee for Best Space Tourist and floats up to accept the award!" },
  e4: { pair: "EVA-suit + Emperor", emoji: "👨‍🚀", scene: "An Emperor tries on the EVA suit and demands more space stars sewn onto his cape!" },
  e5: { pair: "Europa + Alive", emoji: "🌊", scene: "The moon Europa cracks open its icy shell and something Alive pops out and waves hi!" },
  e6: { pair: "Engine + Fix", emoji: "🔧", scene: "The rocket Engine needs a Fix so an alien uses a banana as a wrench and it works!" },
  e7: { pair: "Enceladus + Heaven", emoji: "💫", scene: "Enceladus shoots ice geysers so high they tickle the gates of space Heaven!" },
  e8: { pair: "Exomoon + Estate", emoji: "🌙", scene: "A tiny Exomoon owns a huge Estate of asteroids that circle it like a fairytale garden!" },
  f1: { pair: "Firestar + Bacon", emoji: "⭐", scene: "A fiery Firestar loves Bacon so much it sizzles bacon strips across every galaxy!" },
  f2: { pair: "Fuelcell + Timbuktu", emoji: "🔋", scene: "A rocket Fuel cell has enough juice to travel all the way to Timbuktu and back!" },
  f3: { pair: "Flyby + Committee", emoji: "🚀", scene: "Every planet Flyby is voted on by a Committee of space ants who love waving flags!" },
  f4: { pair: "Frostmoon + Sophomore", emoji: "🌙", scene: "The Frostmoon is a Sophomore in Star School and hands in ice-covered homework late!" },
  f5: { pair: "Flare + Jive", emoji: "🌟", scene: "A solar Flare does the Jive so energetically it powers the whole space station!" },
  f6: { pair: "Flightpath + Sticks", emoji: "🛸", scene: "A Flightpath is marked by glowing Sticks that only rockets can see in the deep dark!" },
  f7: { pair: "Farside + Coven", emoji: "🌑", scene: "The far side of the moon hides a Coven of moon-witches who bake cheese under starlight!" },
  f8: { pair: "Fusioncore + Create", emoji: "⚛️", scene: "A Fusion core can Create a brand-new star from just a spoonful of hydrogen!" },
  g1: { pair: "Galaxy + Ribbon", emoji: "🌌", scene: "A Galaxy is a long silvery Ribbon that ties around planets like birthday presents!" },
  g2: { pair: "Graviton + Boohoo", emoji: "💙", scene: "A Graviton feels lonely and cries a big Boohoo that pulls every planet closer for a hug!" },
  g3: { pair: "Geostationary + Trustee", emoji: "🛰️", scene: "A Geostationary satellite is the Trustee of every text message zooming across the world!" },
  g4: { pair: "Gascloud + Furthermore", emoji: "☁️", scene: "A giant Gas cloud says 'Furthermore!' and swallows another whole planet just to make its point!" },
  g5: { pair: "Gravitywaves + Thrive", emoji: "🌊", scene: "Gravity waves Thrive when they find a bouncy castle in deep space and jump all day!" },
  g6: { pair: "Globularcluster + Tricks", emoji: "⭐", scene: "A Globular cluster performs magic Tricks and pulls a fresh comet from behind Saturn's ear!" },
  g7: { pair: "Ganymede + Riven", emoji: "🌕", scene: "The moon Ganymede is Riven by ancient cracks that light up whenever a spaceship flies over!" },
  g8: { pair: "Gravitylens + Update", emoji: "🔭", scene: "A Gravity lens gets a magic Update and now shows every hidden star in the universe!" },
  h1: { pair: "Hyperdrive + Wonton", emoji: "🚀", scene: "The Hyperdrive is powered by one perfectly folded Wonton dumpling from a cosmic kitchen!" },
  h2: { pair: "Hubble + Hullabaloo", emoji: "🔭", scene: "The Hubble telescope catches a Hullabaloo of aliens partying on a purple planet!" },
  h3: { pair: "Halo + Vietnamese", emoji: "😇", scene: "A planet's glowing Halo learns to speak Vietnamese to greet every visiting spaceship!" },
  h4: { pair: "Hotjupiter + Nevermore", emoji: "🪐", scene: "Hot Jupiter's storms rage Nevermore since a giant fan-shaped moon cooled them down!" },
  h5: { pair: "Hyperspace + Chive", emoji: "🌌", scene: "Hyperspace smells exactly like Chive and every astronaut gets very hungry travelling through it!" },
  h6: { pair: "Heliopause + Bricks", emoji: "🍭", scene: "The Heliopause is built of glowing Bricks that no probe can climb past without permission!" },
  h7: { pair: "Horizon-event + Eleven", emoji: "🕳️", scene: "The event horizon of a black hole makes every clock jump straight to Eleven o'clock forever!" },
  h8: { pair: "Halleycomet + Trait", emoji: "☄️", scene: "Halley's comet has one very famous Trait — it always comes back exactly seventy-six years later!" },
};

const SET5: Record<string, Scene> = {
  a1: { pair: "Anglerfish + Ton", emoji: "🐟", scene: "An Anglerfish glows so bright it lights a whole Ton of glittering fish at once!" },
  a2: { pair: "Anemone + Chew", emoji: "🌺", scene: "An Anemone Chews softly on tiny shrimp snacks it caught with its waving arms!" },
  a3: { pair: "Anchor + Bee", emoji: "⚓", scene: "A rusty Anchor is home to one busy Bee-shaped fish that buzzes around it!" },
  a4: { pair: "Amberjack + War", emoji: "🐠", scene: "An Amberjack races into a War with a shark and wins by wiggling its tail super fast!" },
  a5: { pair: "Algae + Hive", emoji: "🌿", scene: "A big patch of Algae is actually a Hive where tiny sea bees make salty honey!" },
  a6: { pair: "Abalone + Bricks", emoji: "🐚", scene: "An Abalone shell stacks pearl Bricks and builds a shiny castle on the ocean floor!" },
  a7: { pair: "Atlantis + Heaven", emoji: "🏛️", scene: "Atlantis floats up to Heaven and the fish wave goodbye from the clouds!" },
  a8: { pair: "Albacore + Skate", emoji: "🐟", scene: "An Albacore tuna puts on tiny ice Skates and glides across a frozen tide pool!" },
  b1: { pair: "Blowfish + Bun", emoji: "🐡", scene: "A Blowfish puffs up so big it looks exactly like a giant sesame Bun!" },
  b2: { pair: "Barnacle + Blue", emoji: "🦞", scene: "A Barnacle turns bright Blue when it hitches a ride on a whale's back!" },
  b3: { pair: "Beluga + Ghee", emoji: "🐋", scene: "A Beluga whale slides through the water like a giant scoop of golden Ghee!" },
  b4: { pair: "Barracuda + Roar", emoji: "🐟", scene: "A Barracuda opens its toothy mouth and lets out a bubbly Roar that shakes the reef!" },
  b5: { pair: "Blue Whale + Dive", emoji: "🐳", scene: "A Blue whale does a perfect Olympic Dive and makes a splash the size of a city!" },
  b6: { pair: "Brittlestar + Mix", emoji: "⭐", scene: "A Brittlestar tumbles into a swirl and Mixes up its arms into a five-pointed jumble!" },
  b7: { pair: "Bioluminescence + Eleven", emoji: "✨", scene: "Eleven glowing jellyfish line up to spell out their favorite number!" },
  b8: { pair: "Box Jellyfish + Plate", emoji: "🪼", scene: "A Box jellyfish puts a tiny Plate on its head and pretends to be a fancy waiter!" },
  c1: { pair: "Clownfish + Fun", emoji: "🐠", scene: "A Clownfish throws a party because Fun is its whole entire job!" },
  c2: { pair: "Crab + Shoe", emoji: "🦀", scene: "A Crab tries on a tiny Shoe and marches around the sand like a fancy general!" },
  c3: { pair: "Coral + Pea", emoji: "🪸", scene: "A piece of Coral hides a tiny Pea in its holes and grows it into a shiny pearl!" },
  c4: { pair: "Catfish + Snore", emoji: "🐟", scene: "A Catfish falls asleep on a lily pad and Snores so loud it makes bubbles!" },
  c5: { pair: "Conch + Five", emoji: "🐚", scene: "A Conch shell holds up Five fingers and shouts it can hear the whole ocean!" },
  c6: { pair: "Cuttlefish + Chicks", emoji: "🦑", scene: "A Cuttlefish changes color to look like six fluffy Chicks and fools everyone!" },
  c7: { pair: "Clam + Leaven", emoji: "🦪", scene: "A Clam adds Leaven to its shell and watches itself puff up like fresh bread!" },
  c8: { pair: "Chambered Nautilus + Late", emoji: "🐚", scene: "A Chambered nautilus keeps spiraling back because it is always very Late!" },
  d1: { pair: "Dolphin + Run", emoji: "🐬", scene: "A Dolphin leaps out of the water and goes for a Run along the beach on its tail!" },
  d2: { pair: "Dugong + Zoo", emoji: "🐄", scene: "A Dugong wanders into the Zoo and every animal comes over to say a friendly hello!" },
  d3: { pair: "Deep-sea Diver + Fee", emoji: "🤿", scene: "A Deep-sea diver pays a small Fee at the ocean gate and gets to see all the fish!" },
  d4: { pair: "Dragonfish + Store", emoji: "🐉", scene: "A Dragonfish opens a Store selling glowing lures and every fish wants to buy one!" },
  d5: { pair: "Damselfish + Drive", emoji: "🐟", scene: "A tiny Damselfish sits behind a wheel and takes a Drive through the coral reef!" },
  d6: { pair: "Driftwood + Sticks", emoji: "🪵", scene: "A piece of Driftwood joins two Sticks and builds a tiny sailboat for a hermit crab!" },
  d7: { pair: "Deadlights + Heaven", emoji: "💀", scene: "A shipwreck's Deadlights glow all the way up to Heaven guiding lost sailors home!" },
  d8: { pair: "Dory + Great", emoji: "🐟", scene: "A forgetful fish named Dory forgets her own name and then remembers it is Great!" },
  e1: { pair: "Eel + Won", emoji: "⚡", scene: "An electric Eel zaps a shiny gold cup because it Won first place in the sea Olympics!" },
  e2: { pair: "Emperor Shrimp + Crew", emoji: "🦐", scene: "An Emperor shrimp gathers a tiny Crew of plankton and sets sail on a leaf!" },
  e3: { pair: "Estuarine Crocodile + Tea", emoji: "🐊", scene: "An Estuarine crocodile sits in a tiny chair and sips a cup of salty sea Tea!" },
  e4: { pair: "Epaulette Shark + Boar", emoji: "🦈", scene: "An Epaulette shark walks on its fins like a friendly little Boar of the sea floor!" },
  e5: { pair: "Electric Ray + Alive", emoji: "⚡", scene: "An Electric ray zaps itself by mistake and shouts I am very much Alive!" },
  e6: { pair: "Eelgrass + Fix", emoji: "🌿", scene: "A tangle of Eelgrass wraps around a submarine engine and tries hard to Fix it!" },
  e7: { pair: "Expedition Ship + Heaven", emoji: "🚢", scene: "An Expedition ship floats so high on a wave it bumps its head on Heaven!" },
  e8: { pair: "Echinoderm + Gate", emoji: "⭐", scene: "A spiny Echinoderm stands at the sea Gate and pokes any grumpy fish that tries to leave!" },
  f1: { pair: "Flounder + Nun", emoji: "🐟", scene: "A Flounder wears a black and white habit and everyone thinks it is a tiny Nun!" },
  f2: { pair: "Frogfish + Stew", emoji: "🐸", scene: "A lumpy Frogfish stirs a giant Stew and all the seaweed dances in the bubbling pot!" },
  f3: { pair: "Flying Fish + Flea", emoji: "🐟", scene: "A Flying fish soars out of the water and nearly lands on a very surprised Flea!" },
  f4: { pair: "Fangtooth + Snore", emoji: "🦷", scene: "A Fangtooth Snores so loudly its huge teeth rattle and scare every deep-sea shrimp!" },
  f5: { pair: "Firefly Squid + Jive", emoji: "🦑", scene: "A glowing Firefly squid blinks its lights and does the Jive on the ocean floor!" },
  f6: { pair: "Feather Star + Tricks", emoji: "🌟", scene: "A Feather star waves its frilly arms and does magic Tricks that dazzle every fish!" },
  f7: { pair: "Fisherman + Seven Seas", emoji: "🎣", scene: "An old Fisherman sails all Seven Seas but only ever catches one tiny sardine!" },
  f8: { pair: "Frigate Bird + Ate", emoji: "🐦", scene: "A Frigate bird Ate a whole flying fish in one gulp and burps a rainbow feather!" },
  g1: { pair: "Giant Squid + Gun", emoji: "🦑", scene: "A Giant squid holds a water Gun in each of its ten arms and soaks everybody!" },
  g2: { pair: "Grouper + Glue", emoji: "🐟", scene: "A chubby Grouper drops a bottle of Glue and every fish gets stuck in a giggling clump!" },
  g3: { pair: "Ghost Shrimp + Ski", emoji: "👻", scene: "A see-through Ghost shrimp straps on tiny Skis and slaloms down a kelp slope!" },
  g4: { pair: "Gulper Eel + More", emoji: "🐍", scene: "A Gulper eel opens its enormous mouth and yells 'More fish please!' at the whole ocean!" },
  g5: { pair: "Goby + Thrive", emoji: "🐟", scene: "A tiny Goby fish reads a book called How To Thrive In A Very Big Ocean!" },
  g6: { pair: "Greenling + Kicks", emoji: "🐟", scene: "A Greenling Kicks up sand into a swirling green cloud and everyone yells 'do it again!'" },
  g7: { pair: "Grotto + Coven", emoji: "🏔️", scene: "A dark ocean Grotto hides a Coven of witch-fish brewing bubbly seaweed potion!" },
  g8: { pair: "Great White + Weight", emoji: "🦈", scene: "A Great White shark shows off its Weight by lifting a whole shipwreck with its nose!" },
  h1: { pair: "Hammerhead + Swan", emoji: "🦈", scene: "A Hammerhead shark tries a graceful Swan dive but belly-flops instead!" },
  h2: { pair: "Hermit Crab + True", emoji: "🦀", scene: "A Hermit crab shows all the sea shells its True cozy home is inside an old boot!" },
  h3: { pair: "Horseshoe Crab + Knee", emoji: "🦀", scene: "A Horseshoe crab tries to bend its Knee but realizes it does not have one!" },
  h4: { pair: "Humpback Whale + Bore", emoji: "🐋", scene: "A Humpback whale sings a whole song so long every fish nearly falls asleep from Bore!" },
  h5: { pair: "Hagfish + Chive", emoji: "🐟", scene: "A slimy Hagfish grows a little Chive on its nose and calls itself a gourmet fish!" },
  h6: { pair: "Hydrothermal Vent + Licks", emoji: "🌋", scene: "A Hydrothermal vent Licks its hot smoky lips and says dinner is served down here!" },
  h7: { pair: "Hull + Given", emoji: "🚢", scene: "A shipwreck Hull has Given every fish a cozy new home to hide inside!" },
  h8: { pair: "Halibut + Late", emoji: "🐟", scene: "A flat Halibut swims to breakfast very Late and finds all the shrimp already gone!" },
};

const SET6: Record<string, Scene> = {
  a1: { pair: "Ape + Nun", emoji: "🐵", scene: "An Ape dresses up as a Nun and hands out bananas to every jungle creature!" },
  a2: { pair: "Antelope + Chew", emoji: "🦌", scene: "An Antelope stops to Chew a giant leaf and every gazelle gathers around to watch!" },
  a3: { pair: "Anaconda + Ghee", emoji: "🐍", scene: "An Anaconda coils around a pot of golden Ghee and slides shiny across the jungle floor!" },
  a4: { pair: "Armadillo + Chore", emoji: "🛡️", scene: "An Armadillo helps with every jungle Chore by rolling into a ball and dusting things clean!" },
  a5: { pair: "Aardvark + Hive", emoji: "🐝", scene: "An aardvark sticks its long nose right into a buzzing Hive." },
  a6: { pair: "Anteater + Sticks", emoji: "🪵", scene: "An anteater juggles six muddy Sticks with its sticky tongue." },
  a7: { pair: "Aviary + Heaven", emoji: "☁️", scene: "The Aviary floats up up up and almost reaches Heaven." },
  a8: { pair: "Acacia + Gate", emoji: "🌲", scene: "A tall acacia tree crashes through the safari Gate." },
  b1: { pair: "Buffalo + Ton", emoji: "🦬", scene: "A Buffalo weighs a whole Ton and every scale in the safari camp breaks under it!" },
  b2: { pair: "Baboon + Blue", emoji: "🐒", scene: "A Baboon paints its face bright Blue and every monkey shrieks with jealous delight!" },
  b3: { pair: "Beetle + Fee", emoji: "🐛", scene: "A giant jungle Beetle collects a Fee of one shiny leaf from every bug that walks by!" },
  b4: { pair: "Boa + Sore", emoji: "🐍", scene: "A Boa slithers so long its tail gets Sore and it curls into a squishy nap ball!" },
  b5: { pair: "Bush + Dive", emoji: "🌿", scene: "A monkey does a spectacular Dive straight into a leafy Bush." },
  b6: { pair: "Bird + Bricks", emoji: "🦜", scene: "A colorful jungle bird builds its nest out of tiny red Bricks." },
  b7: { pair: "Bat + Eleven", emoji: "🦇", scene: "Eleven bats hang upside down all in a row and count themselves." },
  b8: { pair: "Boar + Plate", emoji: "🐗", scene: "A wild boar eats every banana off a giant Plate in one gulp." },
  c1: { pair: "Croc + Won", emoji: "🐊", scene: "A Croc Won the river race and everyone gives it a big splashy high-five!" },
  c2: { pair: "Chimp + Grew", emoji: "🐒", scene: "A Chimp Grew a giant banana in one day just by singing to it every morning!" },
  c3: { pair: "Cobra + Pea", emoji: "🐍", scene: "A Cobra balances a tiny Pea on the tip of its swaying hood like a magic trick!" },
  c4: { pair: "Crane + Adore", emoji: "🦩", scene: "A Crane bird stretches its long neck and every other bird flies over to Adore it!" },
  c5: { pair: "Cougar + Five", emoji: "🐆", scene: "A cougar high-Fives five explorer kids with its big paw." },
  c6: { pair: "Chameleon + Chicks", emoji: "🦎", scene: "A chameleon turns rainbow colours to impress six fluffy Chicks." },
  c7: { pair: "Cassowary + Leaven", emoji: "🐦", scene: "A cassowary kneads bread dough and waits for the Leaven to rise." },
  c8: { pair: "Caterpillar + Late", emoji: "🐛", scene: "A caterpillar runs as fast as it can because it is always Late." },
  d1: { pair: "Dingo + Done", emoji: "🐕", scene: "A Dingo yells 'Done!' after digging a hole big enough to bury a whole tree stump!" },
  d2: { pair: "Deer + True", emoji: "🦌", scene: "A Deer tells the shy jungle mouse a True bedtime story of ancient forest heroes!" },
  d3: { pair: "Dolphin + Wee", emoji: "🐬", scene: "A river Dolphin gives a Wee little squeak and the whole jungle bursts into laughter!" },
  d4: { pair: "Dragon + Score", emoji: "🐉", scene: "A tiny jungle Dragon keeps Score of every marshmallow it toasts on its flame breath!" },
  d5: { pair: "Dung Beetle + Drive", emoji: "🐞", scene: "A dung beetle learns to Drive a little jeep through the mud." },
  d6: { pair: "Duck + Kicks", emoji: "🦆", scene: "A duck Kicks six mud pies into the air with its webbed feet." },
  d7: { pair: "Dog + Seven Heads", emoji: "🐕", scene: "A safari dog imagines it has Seven Heads and barks in all directions." },
  d8: { pair: "Dhole + Crate", emoji: "🐕", scene: "A wild dhole pup climbs into a wooden Crate and peeks out." },
  e1: { pair: "Elephant + Pun", emoji: "🐘", scene: "An Elephant tells a Pun so bad that even the giggling toucan groans loudly!" },
  e2: { pair: "Eagle + View", emoji: "🦅", scene: "An Eagle soars up for the best View and reports back on where every leopard is hiding!" },
  e3: { pair: "Explorer + Bumblebee", emoji: "🧭", scene: "An Explorer follows a Bumblebee that guides him to the sweetest jungle honey tree!" },
  e4: { pair: "Emu + Bore", emoji: "🦤", scene: "An Emu tries to Bore a tunnel with its beak but the jungle dirt is too hard!" },
  e5: { pair: "Elk + Alive", emoji: "🦌", scene: "An elk jumps so high it cannot believe it is Alive when it lands." },
  e6: { pair: "Egret + Fix", emoji: "🦢", scene: "An egret tries to Fix the explorer's broken compass with its beak." },
  e7: { pair: "Elephant Calf + Heaven", emoji: "🐘", scene: "A tiny elephant calf floats on bubbles all the way up to Heaven." },
  e8: { pair: "Eland + Skate", emoji: "🦌", scene: "An eland straps leaves to its hooves and tries to Skate on the mud." },
  f1: { pair: "Fox + Sun", emoji: "🦊", scene: "A jungle Fox stares up at the Sun and its orange fur glows like fire!" },
  f2: { pair: "Flamingo + Zoo", emoji: "🦩", scene: "A Flamingo escapes the Zoo and joins a whole jungle full of new pink friends!" },
  f3: { pair: "Frog + Chimpanzee", emoji: "🐸", scene: "A Frog and a giggling Chimpanzee play leap-frog all the way across the whole rainforest!" },
  f4: { pair: "Fruit Bat + Tore", emoji: "🦇", scene: "A Fruit Bat Tore open a mango and juice sprayed onto every leaf in a rainbow arc!" },
  f5: { pair: "Firefly + Jive", emoji: "✨", scene: "A hundred fireflies light up and Jive dance all through the night." },
  f6: { pair: "Fish Eagle + Tricks", emoji: "🦅", scene: "A fish eagle does seven Tricks in the air before catching its lunch." },
  f7: { pair: "Flying Squirrel + Seven Seas", emoji: "🐿️", scene: "A flying squirrel dreams it has sailed all the Seven Seas on a leaf." },
  f8: { pair: "Fennec + Weight", emoji: "🦊", scene: "A tiny fennec fox lifts a huge Weight and everyone cheers wildly." },
  g1: { pair: "Gorilla + Fun", emoji: "🦍", scene: "A Gorilla has so much Fun beating its chest that it starts a jungle drum concert!" },
  g2: { pair: "Giraffe + Loo", emoji: "🦒", scene: "A Giraffe waits at the tiny jungle Loo and its head sticks up above the whole treetop!" },
  g3: { pair: "Gecko + Honeybee", emoji: "🦎", scene: "A Gecko sticks to a Honeybee's back and rides it across the whole rainforest fast!" },
  g4: { pair: "Gazelle + Ignore", emoji: "🦌", scene: "A Gazelle bounces past a sleepy lion and manages to Ignore it all the way home safe!" },
  g5: { pair: "Gnu + Thrive", emoji: "🐃", scene: "A gnu eats every leaf in sight and absolutely Thrives in the jungle." },
  g6: { pair: "Grasshopper + Mix", emoji: "🦗", scene: "A grasshopper DJ Mixes jungle beats by clicking its legs together." },
  g7: { pair: "Gibbon + Seven Dwarfs", emoji: "🐒", scene: "A gibbon swings into a treehouse where Seven Dwarfs are having dinner." },
  g8: { pair: "Giant Tortoise + Great", emoji: "🐢", scene: "A giant tortoise wins the race and everyone shouts that it is Great." },
  h1: { pair: "Hippo + Spun", emoji: "🦛", scene: "A Hippo Spun around in the mud and every splash turned into a rainbow puddle!" },
  h2: { pair: "Hyena + Shoe", emoji: "🐾", scene: "A Hyena laughs so hard it falls right into a giant muddy Shoe!" },
  h3: { pair: "Hornbill + Referee", emoji: "🦜", scene: "A Hornbill acts as Referee for every jungle race and blows its beak like a whistle!" },
  h4: { pair: "Hog + Encore", emoji: "🐗", scene: "A Hog burps a song so funny every animal shouts 'Encore!' from the treetops!" },
  h5: { pair: "Heron + Chive", emoji: "🦢", scene: "A heron seasons its fish with a sprig of Chive and looks very pleased." },
  h6: { pair: "Hamster + Licks", emoji: "🐹", scene: "A jungle hamster Licks a giant lollipop bigger than its whole head." },
  h7: { pair: "Hawk + Seventh Sky", emoji: "🦅", scene: "A hawk soars so high it reaches the Seventh Sky and waves down." },
  h8: { pair: "Hartebeest + Ate", emoji: "🦌", scene: "A hartebeest Ate eight bananas for breakfast and fell fast asleep." },
};

const SET7: Record<string, Scene> = {
  a1: { pair: "Aladdin + Ton", emoji: "🪔", scene: "Aladdin's magic lamp weighs a Ton and the genie has to lift it for him each morning!" },
  a2: { pair: "Aurora + Grew", emoji: "🌸", scene: "Aurora Grew twelve inches taller during her hundred-year nap and now needs new shoes!" },
  a3: { pair: "Alice + Ghee", emoji: "🐇", scene: "Alice sips a tiny cup of Ghee and shrinks small enough to fit through the mouse door!" },
  a4: { pair: "Anna + Chore", emoji: "❄️", scene: "Anna finishes every icy Chore in the castle by sliding across the floors in her socks!" },
  a5: { pair: "Ariel + Hive", emoji: "🐠", scene: "Ariel pokes an underwater Hive and a hundred bubble-bees zoom out." },
  a6: { pair: "Andersen + Sticks", emoji: "📖", scene: "Andersen the storyteller builds a tiny hut from Sticks and tells tales inside." },
  a7: { pair: "Avalon + Heaven", emoji: "🏰", scene: "Avalon floats so high it tickles the clouds of Heaven every morning." },
  a8: { pair: "Archer + Gate", emoji: "🏹", scene: "The Archer shoots a golden arrow that rings the castle Gate like a bell." },
  b1: { pair: "Beast + Won", emoji: "🥀", scene: "The Beast Won a rose-growing contest and finally learned how to smile a big fanged grin!" },
  b2: { pair: "Belle + Loo", emoji: "📚", scene: "Belle reads her favorite book so long in the Loo that the beast worries she vanished!" },
  b3: { pair: "Beanstalk + Pea", emoji: "🌱", scene: "The Beanstalk grew from one magic Pea and now touches the clouds where the giant lives!" },
  b4: { pair: "Briar + Sore", emoji: "🌹", scene: "The Briar rose bushes are so Sore from thorn-poking they hire a fairy to soothe them!" },
  b5: { pair: "Bluebeard + Dive", emoji: "🗝️", scene: "Bluebeard does a huge belly Dive into his treasure room and scares the gold coins." },
  b6: { pair: "Brownie + Bricks", emoji: "🧚", scene: "A helpful Brownie lays tiny Bricks to fix the pig's house while everyone sleeps." },
  b7: { pair: "Buckwheat + Eleven", emoji: "🍞", scene: "The magic Buckwheat loaf feeds Eleven hungry dwarfs and still has one slice left." },
  b8: { pair: "Bluebird + Plate", emoji: "🐦", scene: "The enchanted Bluebird delivers a hot Plate of porridge right to Goldilocks." },
  c1: { pair: "Cinderella + Done", emoji: "👠", scene: "Cinderella yells 'Done!' as she finishes every chore in one magic swoop of her broom!" },
  c2: { pair: "Cauldron + View", emoji: "🪄", scene: "The witch's Cauldron shows a magic View of every castle in the kingdom bubbling inside!" },
  c3: { pair: "Castle + Fee", emoji: "🏰", scene: "The Castle charges a Fee of one shiny bean for every knight who wants to enter!" },
  c4: { pair: "Charm + Adore", emoji: "✨", scene: "The sleeping Charm is so lovely every fairy who visits stops just to Adore the sleeping princess!" },
  c5: { pair: "Cupboard + Five", emoji: "🚪", scene: "Behind the magic Cupboard live Five tiny elves who only come out on Tuesdays." },
  c6: { pair: "Crystal + Chicks", emoji: "💎", scene: "The Crystal ball hatches six fluffy Chicks and they peep at the surprised wizard." },
  c7: { pair: "Cobbler + Leaven", emoji: "👞", scene: "The elf Cobbler puts Leaven in his bread so it rises up and lifts the shoes off the shelf." },
  c8: { pair: "Coach + Late", emoji: "🎃", scene: "Cinderella's Coach turns back to a pumpkin and she is very Late for breakfast." },
  d1: { pair: "Dragon + Spun", emoji: "🐉", scene: "The Dragon Spun around so fast its flame trail drew a fiery circle above the castle!" },
  d2: { pair: "Dwarf + Cashew", emoji: "⛏️", scene: "A Dwarf finds a giant Cashew in the mine and shares it with all his six siblings!" },
  d3: { pair: "Donkey + Wee", emoji: "🫏", scene: "Pinocchio's Donkey ears pop out and he lets out a Wee little bray of surprise!" },
  d4: { pair: "Duchess + Score", emoji: "👑", scene: "The Duchess keeps Score of every teacup at her royal tea and misses none of them!" },
  d5: { pair: "Diamond + Drive", emoji: "💎", scene: "The Diamond slipper takes the coach on a magical Drive through the sparkling forest." },
  d6: { pair: "Djinn + Kicks", emoji: "🧞", scene: "The Djinn pops out of the bottle and Kicks the lid so high it lands on the moon." },
  d7: { pair: "Dame + Seven Heads", emoji: "🧙‍♀️", scene: "The wise Dame counts the dragon's Seven Heads and names every single one." },
  d8: { pair: "Dungeon + Crate", emoji: "🗝️", scene: "The princess finds a secret Crate in the Dungeon filled with singing mice." },
  e1: { pair: "Elf + Pun", emoji: "🧝", scene: "One tiny Elf tells a Pun so silly the whole cobbler workshop rolls with tiny giggles!" },
  e2: { pair: "Enchantress + Kangaroo", emoji: "🪄", scene: "The Enchantress turns her royal carriage into a giant hopping Kangaroo overnight!" },
  e3: { pair: "Emperor + Bumblebee", emoji: "👘", scene: "The Emperor's new clothes are made of nothing but a swarm of buzzing Bumblebees!" },
  e4: { pair: "Egg + Bore", emoji: "🥚", scene: "Humpty Dumpty on the wall is such a Bore he puts every royal horse to sleep!" },
  e5: { pair: "Enchanted Forest + Alive", emoji: "✨", scene: "The Enchanted forest comes Alive and all the trees giggle at the lost knight." },
  e6: { pair: "Evil Queen + Fix", emoji: "🍎", scene: "The Evil Queen tries to Fix her magic mirror but it only tells jokes now." },
  e7: { pair: "Elixir + Heaven", emoji: "⚗️", scene: "One sip of the Elixir sends the little princess floating up toward Heaven like a balloon." },
  e8: { pair: "Eldest Princess + Skate", emoji: "👸", scene: "The Eldest princess puts on her glass shoes and tries to Skate across the frozen moat." },
  f1: { pair: "Fairy + Nun", emoji: "🧚", scene: "The Fairy godmother is so startled by a Nun she turns the broom into a horse." },
  f2: { pair: "Frog Prince + Chew", emoji: "🐸", scene: "The Frog Prince sits on a golden plate and Chews his lily pad very loudly." },
  f3: { pair: "Fox + Flea", emoji: "🦊", scene: "The clever Fox flicks a Flea off his ear and it lands in the witch's cauldron." },
  f4: { pair: "Flask + Store", emoji: "⚗️", scene: "The wizard keeps every spell in a Flask he bought at the magic Store downtown." },
  f5: { pair: "Faun + Jive", emoji: "🐾", scene: "The Faun does a wild Jive dance and his hooves make the forest floor shake." },
  f6: { pair: "Fiend + Tricks", emoji: "👺", scene: "The sneaky Fiend plays Tricks on the three little pigs by gluing their door shut." },
  f7: { pair: "Fountain + Seven Seas", emoji: "⛲", scene: "The wishing Fountain has sailed the Seven Seas and grants wishes smelling of seaweed." },
  f8: { pair: "Fortress + Weight", emoji: "🏰", scene: "The Fortress gate is so heavy even the giant uses all his Weight to push it open." },
  g1: { pair: "Giant + Gun", emoji: "🌩️", scene: "The Giant sneezes so hard it sounds like a Gun and Jack tumbles off the beanstalk." },
  g2: { pair: "Genie + Blue", emoji: "🧞", scene: "The Genie pops out completely Blue and says he ran out of other colours today." },
  g3: { pair: "Gnome + Ski", emoji: "🏔️", scene: "The little Gnome straps mushrooms to his feet and tries to Ski down the enchanted hill." },
  g4: { pair: "Griffin + Pour", emoji: "🦅", scene: "The Griffin tips the rain cloud over to Pour gold coins on the sleeping princess." },
  g5: { pair: "Goblin + Thrive", emoji: "👺", scene: "The Goblin tends his magic garden and all his pumpkins Thrive into giant coaches." },
  g6: { pair: "Gretel + Mix", emoji: "🍭", scene: "Gretel finds the candy house and tries to Mix the chocolate door into a smoothie." },
  g7: { pair: "Godmother + Seven Dwarfs", emoji: "🧚", scene: "The Godmother visits the Seven Dwarfs and turns them all into tiny carriages." },
  g8: { pair: "Gargoyle + Great", emoji: "🗿", scene: "The Gargoyle perches on the Great castle tower and makes silly faces at knights." },
  h1: { pair: "Hansel + Swan", emoji: "🍬", scene: "Hansel rides a friendly Swan because the witch ate all his breadcrumb trail again." },
  h2: { pair: "Hedgehog + Shoe", emoji: "🦔", scene: "The enchanted Hedgehog tries on Cinderella's glass Shoe and gets his snout stuck." },
  h3: { pair: "Hermit + Knee", emoji: "🧙", scene: "The old Hermit wizard bows so low his Knee touches the floor and flowers bloom." },
  h4: { pair: "Hag + Boar", emoji: "🧟", scene: "The wicked Hag turns the prince into a Boar and he snuffles for truffles." },
  h5: { pair: "Horn + Chive", emoji: "🦄", scene: "The unicorn's Horn chops the Chive so fine it sprinkles onto the dragon's soup." },
  h6: { pair: "Herald + Licks", emoji: "📯", scene: "The royal Herald Licks the enchanted trumpet and it plays a tune that wakes the royals." },
  h7: { pair: "Highness + Seventh Sky", emoji: "👑", scene: "Her Highness floats up to the Seventh Sky on a bubble and waves at the stars." },
  h8: { pair: "Huntsman + Ate", emoji: "🪓", scene: "The kind Huntsman baked eight pies and Ate every last one before the wolf arrived." },
};

const SET8: Record<string, Scene> = {
  a1: { pair: "Antman + Ton", emoji: "🐜", scene: "Antman shrinks tiny then lifts a whole Ton of sugar cubes over his little head!" },
  a2: { pair: "Aquaman + Cockatoo", emoji: "🐟", scene: "Aquaman rides a Cockatoo above the waves waving to every fish below the boat!" },
  a3: { pair: "Avenger + Fee", emoji: "🌳", scene: "The Avenger charges a small Fee of one gold coin to save every city from villains!" },
  a4: { pair: "Atom + Chore", emoji: "⚛️", scene: "Atom shrinks tiny to do every kitchen Chore in just one super speedy second!" },
  a5: { pair: "Archer + Hive", emoji: "🏹", scene: "Archer shoots an arrow and it lands right in the bee Hive — oops!" },
  a6: { pair: "Acrobat-hero + Fix", emoji: "🤸", scene: "The Acrobat-hero can Fix any twisted rope with one perfectly-timed backflip!" },
  a7: { pair: "Aqualad + Heaven", emoji: "💧", scene: "Aqualad swims so high he splashes all the clouds in Heaven!" },
  a8: { pair: "Atlas + Bait", emoji: "💪", scene: "Atlas uses a whole planet as fishing Bait and catches a shooting star!" },
  b1: { pair: "Batman + Done", emoji: "🦇", scene: "Batman shouts 'Done!' after catching the last crook and swings back to his cave!" },
  b2: { pair: "Bolt + Bamboo", emoji: "⚡", scene: "Bolt runs so fast up a Bamboo stalk it grows leaves before he reaches the top!" },
  b3: { pair: "Bee-hero + Pea", emoji: "🐝", scene: "Bee-hero rolls a tiny Pea into his hive and turns it into a shiny green treasure!" },
  b4: { pair: "Blizzard + Sore", emoji: "❄️", scene: "Blizzard's icy blast leaves every villain with a Sore blue nose that giggles cold!" },
  b5: { pair: "Blaster + Dive", emoji: "💥", scene: "Blaster takes a giant Dive into the pool and blasts water everywhere!" },
  b6: { pair: "Bumble + Ticks", emoji: "🐝", scene: "Bumble buzzes so fast her wings Tick like a clock going tick-tock across the flowers!" },
  b7: { pair: "Bolt-boy + Eleven", emoji: "⚡", scene: "Bolt-boy runs around the track Eleven times before breakfast is ready!" },
  b8: { pair: "Blaze + Fate", emoji: "🔥", scene: "Blaze sees his Fate written in fiery letters and cannot stop laughing at the joke!" },
  c1: { pair: "Cape-hero + None", emoji: "🦸", scene: "Cape-hero looks for a villain and finds None — bad guys hid from his epic swoosh!" },
  c2: { pair: "Cyclone + Kangaroo", emoji: "🌪️", scene: "Cyclone spins so fast she scoops up a Kangaroo and gives it the fastest ride ever!" },
  c3: { pair: "Comet-hero + Ghee", emoji: "☄️", scene: "Comet-hero streaks past a jar of Ghee and its buttery light stays glowing all night!" },
  c4: { pair: "Crystal-hero + Bore", emoji: "💎", scene: "Crystal shines so bright that even the sleepy villain admits her power is no Bore!" },
  c5: { pair: "Captain + Five", emoji: "🦸", scene: "Captain holds up Five fingers and five rockets launch at once!" },
  c6: { pair: "Cosmo + Wicks", emoji: "🌌", scene: "Cosmo zooms past and every candle Wick in the galaxy lights up in a starry line!" },
  c7: { pair: "Crane-hero + Leaven", emoji: "🦅", scene: "Crane flaps her giant wings so gently the bread dough rises with Leaven by itself!" },
  c8: { pair: "Colossal + Freight", emoji: "🦣", scene: "Colossal loads himself onto a Freight train and the train wobbles down the tracks giggling!" },
  d1: { pair: "Dash + Won", emoji: "💨", scene: "Dash Won every race in one second flat and now needs a bigger trophy shelf!" },
  d2: { pair: "Dynamo + Peekaboo", emoji: "⚡", scene: "Dynamo plays Peekaboo with a cloud and every lightning bolt giggles between claps!" },
  d3: { pair: "Diver-hero + Wee", emoji: "🤿", scene: "Diver leaps from the clouds and lets out a Wee little splash into the blue sea!" },
  d4: { pair: "Dragon-hero + Adore", emoji: "🐉", scene: "Dragon-hero shows off shiny scales and every kid runs up to Adore his fiery smile!" },
  d5: { pair: "Dasher + Drive", emoji: "💨", scene: "Dasher hops in the car and goes on the fastest Drive anyone has ever seen!" },
  d6: { pair: "Dynakid + Nix", emoji: "⚡", scene: "Dynakid shouts 'Nix!' and every bad-guy plan fizzles into a tiny puff of smoke!" },
  d7: { pair: "Dazzle + Given", emoji: "✨", scene: "Dazzle has Given every hero their sparkle boost right before the big final battle!" },
  d8: { pair: "Detector + State", emoji: "🔍", scene: "Detector sniffs out every hidden cookie in the whole State and finishes them all!" },
  e1: { pair: "Electric + Spun", emoji: "⚡", scene: "Electric Spun a wire around a tree and lit up the whole neighbourhood at once!" },
  e2: { pair: "Eagle-eye + Tattoo", emoji: "🦅", scene: "Eagle-eye spots a tiny Tattoo on an ant's shoulder from a mile up in the sky!" },
  e3: { pair: "Elasto + Bee", emoji: "🤸", scene: "Elasto stretches so long that every Bee mistakes him for a stretchy garden hose!" },
  e4: { pair: "Ember + Score", emoji: "🔥", scene: "Ember keeps Score of every marshmallow the heroes toast on her friendly fingertip!" },
  e5: { pair: "Energizer + Alive", emoji: "⚡", scene: "Energizer touches a wilted flower and it jumps Alive, bouncing up and down happily!" },
  e6: { pair: "Echo + Picks", emoji: "📣", scene: "Echo shouts and Picks up her own voice a mile away then puts it in her pocket!" },
  e7: { pair: "Envoy + Heaven", emoji: "🕊️", scene: "Envoy flies messages all the way up to Heaven and the angels give a big thumbs up!" },
  e8: { pair: "Eclipse-hero + Skate", emoji: "🌑", scene: "Eclipse turns off the sun for a second so everyone can Skate in cool shadow!" },
  f1: { pair: "Flash + Stun", emoji: "⚡", scene: "Flash zooms so fast his sonic boom Stuns every villain into a big long yawn!" },
  f2: { pair: "Falcon + Taboo", emoji: "🦅", scene: "Falcon swoops through the Taboo forbidden zone and every villain gasps in awe!" },
  f3: { pair: "Firefly-hero + Chimpanzee", emoji: "✨", scene: "Firefly lights up so bright even a Chimpanzee climbs down from its tree to see!" },
  f4: { pair: "Forcefield + War", emoji: "🛡️", scene: "Forcefield ends every War by wrapping both sides in a sparkly bubble hug!" },
  f5: { pair: "Flyer + Jive", emoji: "🪂", scene: "Flyer grooves through the sky doing the Jive and loop-the-looping all at once!" },
  f6: { pair: "Frostbite + Sticks", emoji: "❄️", scene: "Frostbite freezes Sticks into icy magic wands and gives one to every kid!" },
  f7: { pair: "Firestorm + Coven", emoji: "🔥", scene: "Firestorm warms up a witch's Coven so all the potions turn into cocoa mugs!" },
  f8: { pair: "Feather + Mate", emoji: "🪶", scene: "Feather finds her best Mate who is also a giant feather and they float away together!" },
  g1: { pair: "Green Lantern + Pun", emoji: "💚", scene: "Green Lantern makes a glowing Pun about lamps and every hero groans loudly!" },
  g2: { pair: "Glider + Igloo", emoji: "🪂", scene: "Glider drops down through the roof of an Igloo and starts a snow-cone party!" },
  g3: { pair: "Glacier + Referee", emoji: "🧊", scene: "Glacier is Referee for the ice-hockey game and freezes the puck mid-air with one glance!" },
  g4: { pair: "Gust + Explore", emoji: "💨", scene: "Gust blows a hero's hat off and both zoom off to Explore where the wind takes them!" },
  g5: { pair: "Galaxy-hero + Thrive", emoji: "🌌", scene: "Galaxy sprinkles stardust and every flower in the garden begins to Thrive and glow!" },
  g6: { pair: "Gadgeteer + Bricks", emoji: "🔧", scene: "Gadgeteer builds a robot out of Bricks and the robot dances the moment it wakes up!" },
  g7: { pair: "Guardian + Riven", emoji: "🛡️", scene: "Guardian shields a mountain that is Riven straight down the middle by ancient magic!" },
  g8: { pair: "Giant-hero + Grate", emoji: "🦣", scene: "Giant-hero shrinks himself and slides through a sewer Grate to rescue a lost kitten!" },
  h1: { pair: "Hawk-hero + Shun", emoji: "🦅", scene: "Hawk-hero Shuns every silly villain plan by soaring higher than any bad guy!" },
  h2: { pair: "Hypno + Shampoo", emoji: "🌀", scene: "Hypno swirls Shampoo bubbles into hypnotic rings and everyone falls asleep foamy!" },
  h3: { pair: "Hulk + Manatee", emoji: "💚", scene: "Hulk cuddles a giant Manatee and the sea creature purrs like a happy green kitten!" },
  h4: { pair: "Hammer-hero + Encore", emoji: "🔨", scene: "Hammer-hero plays his hammer like a drum and every villain shouts 'Encore!' loudly!" },
  h5: { pair: "Hover + Chive", emoji: "🚁", scene: "Hover floats above the garden and uses a Chive stalk as a tiny propeller for fun!" },
  h6: { pair: "Hailstorm + Six", emoji: "🧊", scene: "Hailstorm drops exactly Six ice-cream scoops from the sky and the puppy catches all six!" },
  h7: { pair: "Highflyer + Eleven", emoji: "✈️", scene: "Highflyer soars past exactly Eleven clouds and salutes each one with a proud loop!" },
  h8: { pair: "Hercules + Skate", emoji: "💪", scene: "Hercules Skates so hard the ice rink cracks and turns into a shiny mirror lake!" },
};

const SET9: Record<string, Scene> = {
  a1: { pair: "Aladdin + Ton", emoji: "🧞", scene: "Aladdin's magic lamp weighs a Ton and the genie carries it with one finger!" },
  a2: { pair: "Anna + Bamboo", emoji: "❄️", scene: "Anna from Frozen builds a whole Bamboo forest inside her icy ballroom for fun!" },
  a3: { pair: "Ariel + Fee", emoji: "🧜", scene: "Ariel pays a shiny gold Fee at the sea gate to get shoes for her new legs!" },
  a4: { pair: "Astro Boy + Chore", emoji: "🤖", scene: "Astro Boy zooms through every Chore in the whole city in ten super-fast seconds!" },
  a5: { pair: "Anpanman + Hive", emoji: "🍞", scene: "Anpanman feeds his bread face to bees pouring out of a Hive!" },
  a6: { pair: "Arnold + Fix", emoji: "🏈", scene: "Hey Arnold can Fix any football problem using his very own football-shaped head!" },
  a7: { pair: "Akira + Heaven", emoji: "🏍️", scene: "Akira rides his motorbike so fast he zooms all the way up to Heaven!" },
  a8: { pair: "Arthur + Bait", emoji: "🐜", scene: "Arthur the aardvark uses a Chapter book as Bait to catch his lost library card!" },
  b1: { pair: "Bambi + Done", emoji: "🦌", scene: "Bambi learns to walk and shouts 'Done!' as he takes his very first wobbly step!" },
  b2: { pair: "Baloo + Kangaroo", emoji: "🐻", scene: "Baloo the bear dances with a Kangaroo and every jungle animal hops along!" },
  b3: { pair: "Belle + Ghee", emoji: "🌹", scene: "Belle butters her book pages with Ghee so the pages turn extra smooth!" },
  b4: { pair: "Bugs Bunny + Sore", emoji: "🐰", scene: "Bugs Bunny digs so many tunnels his paws get Sore and he takes a carrot break!" },
  b5: { pair: "Bluey + Dive", emoji: "🐕", scene: "Bluey does a belly-flop Dive into a puddle and soaks Dad completely!" },
  b6: { pair: "Buzz Lightyear + Nix", emoji: "🚀", scene: "Buzz Lightyear shouts 'Nix, evil emperor!' and blasts off with his laser wing power!" },
  b7: { pair: "Bob the Builder + Eleven", emoji: "🔨", scene: "Bob the Builder hammers Eleven nails all at once with one giant swing!" },
  b8: { pair: "Boo + Fate", emoji: "👧", scene: "Little Boo's Fate is one giant sushi dinner with Sully every single Tuesday night!" },
  c1: { pair: "Cinderella + None", emoji: "👠", scene: "Cinderella searches for her slipper and finds None — the prince has taken it home!" },
  c2: { pair: "Chhota Bheem + Cockatoo", emoji: "💪", scene: "Chhota Bheem flexes his muscles and a chirpy Cockatoo lands right on his bicep!" },
  c3: { pair: "Carl + Pea", emoji: "🎈", scene: "Carl from Up ties a tiny Pea to his house and it floats away just like the balloons!" },
  c4: { pair: "Courage + Bore", emoji: "🐶", scene: "Courage the dog is so scared he thinks even a fluffy pillow is a Bore of danger!" },
  c5: { pair: "Coraline + Five", emoji: "🧥", scene: "Coraline buttons up Five coats because the Other World is very very cold!" },
  c6: { pair: "Chip + Ticks", emoji: "🐿️", scene: "Chip the chipmunk collects Ticks off his forest friends and turns them into tiny pets!" },
  c7: { pair: "Chowder + Leaven", emoji: "🍲", scene: "Chowder pours Leaven into his soup and the whole pot bounces off the ceiling!" },
  c8: { pair: "Curious George + Freight", emoji: "🐒", scene: "Curious George sneaks onto a Freight train and takes it for a wobbly banana joyride!" },
  d1: { pair: "Dumbo + Won", emoji: "🐘", scene: "Dumbo Won the flying prize and every circus animal claps with a big happy trumpet!" },
  d2: { pair: "Doraemon + Peekaboo", emoji: "🤖", scene: "Doraemon plays Peekaboo with a magic mirror and thirty of him pop out at once!" },
  d3: { pair: "Dory + Wee", emoji: "🐟", scene: "Dory forgets her own name so many times she gives a Wee giggle every time she remembers!" },
  d4: { pair: "Donald Duck + Adore", emoji: "🦆", scene: "Donald Duck stomps in a puff and Daisy tries to Adore him back to his usual quacky self!" },
  d5: { pair: "Dibo + Drive", emoji: "🐲", scene: "Dibo the gift dragon grants a wish and a tiny car appears for him to Drive!" },
  d6: { pair: "Darkwing Duck + Picks", emoji: "🦸", scene: "Darkwing Duck Picks a fight with a villain then wins by using his cape as a magic net!" },
  d7: { pair: "Dipper + Coven", emoji: "📓", scene: "Dipper from Gravity Falls sneaks up on a Coven of witches and takes very careful notes!" },
  d8: { pair: "Dash + Slate", emoji: "⚡", scene: "Dash writes his name on a Slate so fast the chalk catches on fire in a rainbow spark!" },
  e1: { pair: "Elsa + Spun", emoji: "❄️", scene: "Elsa Spun her ice powers and a whole snowflake stadium appears around her feet!" },
  e2: { pair: "Eeyore + Igloo", emoji: "🫏", scene: "Eeyore's Igloo house melts because his sad sighs are just too warm for the ice!" },
  e3: { pair: "Eddy + Bumblebee", emoji: "🍵", scene: "Eddy sells a jar of Bumblebees for twenty-five cents and brags about it all afternoon!" },
  e4: { pair: "Elmo + Score", emoji: "🔴", scene: "Elmo keeps Score of every tickle he gets and cheers loudly at every new number!" },
  e5: { pair: "Elastigirl + Alive", emoji: "🦸‍♀️", scene: "Elastigirl stretches so far she springs Alive across three whole rooms at once!" },
  e6: { pair: "Ernie + Six", emoji: "🔧", scene: "Ernie counts to Six rubber duckies in his bath and every duck squeaks a happy song!" },
  e7: { pair: "Ewok + Heaven", emoji: "🌟", scene: "Wicket the Ewok thinks the spaceship trail in the sky is the road to Heaven!" },
  e8: { pair: "Edd + Skate", emoji: "🛹", scene: "Edd wears a helmet, knee pads and elbow pads just to Skate one centimetre!" },
  f1: { pair: "Finn + Stun", emoji: "🗡️", scene: "Finn the Human can Stun any villain with a big brave bear-hug that turns them nice!" },
  f2: { pair: "Flounder + Taboo", emoji: "🐠", scene: "Flounder swims through the Taboo forbidden reef and finds it is full of shiny treasure!" },
  f3: { pair: "Fifi + Chimpanzee", emoji: "🌸", scene: "Fifi the Flowertot befriends a tiny Chimpanzee who swings on flower stems all day!" },
  f4: { pair: "Foxface + Explore", emoji: "🦊", scene: "Foxface loves to Explore the woodland forest and finds a new hidden acorn every day!" },
  f5: { pair: "Frosty + Jive", emoji: "⛄", scene: "Frosty the Snowman does a wiggly Jive and his carrot nose flies across the yard!" },
  f6: { pair: "Fievel + Wicks", emoji: "🐭", scene: "Fievel the mouse chews candle Wicks by mistake and puffs out little smoke rings!" },
  f7: { pair: "Flapjack + Oven", emoji: "🍬", scene: "Flapjack falls into a giant candy Oven and comes out tasting like maple syrup!" },
  f8: { pair: "Ferb + Grate", emoji: "🔩", scene: "Ferb slides through a metal Grate to fix a robot then pops out grinning silently!" },
  g1: { pair: "Goofy + Pun", emoji: "🎉", scene: "Goofy tells a Pun so bad he laughs at himself for a whole half hour by mistake!" },
  g2: { pair: "Groot + Voodoo", emoji: "🌱", scene: "Baby Groot dances a Voodoo shuffle and every plant in the garden starts wiggling too!" },
  g3: { pair: "Gumball + Referee", emoji: "🐱", scene: "Gumball is Referee for a food fight and gets hit by every flying pie in the cafeteria!" },
  g4: { pair: "Genie + Encore", emoji: "🧞", scene: "The Genie's show is so cool everyone shouts 'Encore!' until the sun comes up smiling!" },
  g5: { pair: "Gaston + Thrive", emoji: "💪", scene: "Gaston eats five dozen eggs every morning and says that is why he can Thrive!" },
  g6: { pair: "Gerald + Ticks", emoji: "🦒", scene: "Gerald the giraffe Ticks off tall trees on his checklist while eating each one's leaves!" },
  g7: { pair: "Grumpy + Given", emoji: "😠", scene: "Grumpy has Given every dwarf a lecture on whistling properly and none of them listen!" },
  g8: { pair: "Gurgi + Mate", emoji: "🐾", scene: "Gurgi finds his best Mate — a little rabbit — and they share every crunchings and munchings!" },
  h1: { pair: "Hercules + Sun", emoji: "🦢", scene: "Hercules tries to catch the Sun in his hands and it just gives him a warm hug back!" },
  h2: { pair: "Hiro + Shampoo", emoji: "🤖", scene: "Hiro programs Baymax to wash his hair but Baymax uses a whole bottle of Shampoo!" },
  h3: { pair: "Heidi + Honeybee", emoji: "⛰️", scene: "Heidi skips down the mountain following a Honeybee to a giant hidden honeycomb!" },
  h4: { pair: "He-Man + War", emoji: "💥", scene: "Cartoon He-Man ends every War by sitting the bad guys down for a big feast dinner!" },
  h5: { pair: "Handy Manny + Chive", emoji: "🔧", scene: "Handy Manny plants a tiny Chive in his toolbox and it grows right through the lid!" },
  h6: { pair: "Hagrid + Bricks", emoji: "🧙", scene: "Hagrid builds Hogwarts additions from magical Bricks that whistle when placed correctly!" },
  h7: { pair: "Huckleberry Hound + Eleven", emoji: "🐶", scene: "Huckleberry Hound howls the same off-key song Eleven times before anyone joins in!" },
  h8: { pair: "Horton + Skate", emoji: "🐘", scene: "Horton the elephant tries to Skate across a frozen pond and cracks the ice giggling!" },
};

const SET10: Record<string, Scene> = {
  a1: { pair: "Auto-rickshaw + Ton", emoji: "🛺", scene: "An Auto-rickshaw carries a whole Ton of vegetables to market with a happy toot!" },
  a2: { pair: "Aeroplane + Cockatoo", emoji: "✈️", scene: "An Aeroplane lands and a chatty Cockatoo pops out the pilot window saying hello!" },
  a3: { pair: "Ambulance + Fee", emoji: "🚑", scene: "An Ambulance charges no Fee for a ride and every kid cheers when it zooms past!" },
  a4: { pair: "ATV + Chore", emoji: "🏍️", scene: "An ATV finishes every yard Chore in one muddy joyride around the whole garden!" },
  a5: { pair: "Airship + Hive", emoji: "🎈", scene: "An airship floats into a giant Hive and a thousand bees try to fly it away!" },
  a6: { pair: "Airboat + Fix", emoji: "⛵", scene: "An Airboat can Fix any stuck swamp boat by nudging it out with a giant fan blow!" },
  a7: { pair: "Astro-rover + Heaven", emoji: "🛸", scene: "An astro-rover rolls all the way up to Heaven and beeps hello at the clouds!" },
  a8: { pair: "Antique-car + Bait", emoji: "🚗", scene: "An Antique-car uses a wheel of cheese as Bait and every hungry mechanic runs over!" },
  b1: { pair: "Bulldozer + Done", emoji: "🚜", scene: "A Bulldozer flattens a mountain and yells 'Done!' before lunchtime with a happy roar!" },
  b2: { pair: "Bicycle + Bamboo", emoji: "🚲", scene: "A Bicycle made of Bamboo rides so quietly the birds fall asleep on the handlebars!" },
  b3: { pair: "Bus + Ghee", emoji: "🚌", scene: "A big yellow Bus is greased with Ghee and slides down every hill way too fast!" },
  b4: { pair: "Blimp + Sore", emoji: "🎈", scene: "A Blimp bumps its head on the ceiling and gets Sore then pouts for the whole afternoon!" },
  b5: { pair: "Biplane + Dive", emoji: "✈️", scene: "A biplane does a Dive and the pilot's sandwich flies straight up into the sky!" },
  b6: { pair: "Backhoe + Ticks", emoji: "🏗️", scene: "A Backhoe Ticks like a giant clock as it digs up an old buried treasure chest!" },
  b7: { pair: "Buggy + Eleven", emoji: "🏎️", scene: "A dune buggy zooms past Eleven surprised grandmas sitting in a row on their porch!" },
  b8: { pair: "Boat + Fate", emoji: "⛵", scene: "A tiny Boat sails into the mist and its Fate is a magical island of talking turtles!" },
  c1: { pair: "Cable-car + None", emoji: "🚡", scene: "A Cable-car climbs a mountain and finds None on top — the yeti went for tea!" },
  c2: { pair: "Crane + Kangaroo", emoji: "🏗️", scene: "A Crane lifts a friendly Kangaroo onto a rooftop and it hops home very impressed!" },
  c3: { pair: "Caterpillar-tractor + Pea", emoji: "🚜", scene: "A Caterpillar-tractor rolls over a Pea and turns it into the biggest garden pancake!" },
  c4: { pair: "Cargo-ship + Bore", emoji: "🚢", scene: "A Cargo-ship sails so slow it's a Bore and every seagull naps on its tall smokestack!" },
  c5: { pair: "Chopper + Five", emoji: "🚁", scene: "A chopper high-Fives five seagulls with its spinning rotor and they spin away laughing!" },
  c6: { pair: "Concrete-mixer + Nix", emoji: "🌀", scene: "A Concrete-mixer shouts 'Nix!' and every wet spill in the yard instantly hardens shut!" },
  c7: { pair: "Capsule-rocket + Leaven", emoji: "🚀", scene: "A Capsule-rocket rises with the Leaven of a thousand loaves baked in its engine!" },
  c8: { pair: "Camper-van + Freight", emoji: "🚐", scene: "A Camper-van loads onto a Freight train and rides the rails to the next holiday spot!" },
  d1: { pair: "Dragster + Won", emoji: "🏎️", scene: "A Dragster Won the drag race so fast it crossed the finish line before the flag dropped!" },
  d2: { pair: "Dump-truck + Peekaboo", emoji: "🚛", scene: "A Dump-truck tips its load and plays Peekaboo — a hundred cows pop out one by one!" },
  d3: { pair: "Dinghy + Wee", emoji: "⛵", scene: "A tiny Dinghy gives a Wee little bob on the sea and a penguin claps politely inside!" },
  d4: { pair: "Diesel-train + Adore", emoji: "🚂", scene: "A Diesel-train tootles by and every kid runs to Adore its shiny red locomotive nose!" },
  d5: { pair: "Delivery-drone + Drive", emoji: "🚁", scene: "A delivery drone crash-lands in the Drive and leaves a pizza on the garden gnome!" },
  d6: { pair: "Digger + Picks", emoji: "⛏️", scene: "A Digger Picks up a whole tree with its bucket and gently sets it down two yards over!" },
  d7: { pair: "Double-decker + Given", emoji: "🚌", scene: "A Double-decker bus has Given a ride to every child in the city for free today!" },
  d8: { pair: "Dune-buggy + State", emoji: "🏍️", scene: "A Dune-buggy zooms across a whole State overnight without stopping for anything but pizza!" },
  e1: { pair: "Electric-car + Spun", emoji: "🚗", scene: "An Electric-car Spun its silent wheels and beat every roaring hot rod at the race!" },
  e2: { pair: "Excavator + Tattoo", emoji: "🏗️", scene: "An Excavator has a Tattoo of a small tractor on its arm and shows it off proudly!" },
  e3: { pair: "Express-train + Bumblebee", emoji: "🚄", scene: "An Express-train races a Bumblebee across the countryside and both cheer at the finish!" },
  e4: { pair: "Engine + Score", emoji: "🔧", scene: "A giant Engine keeps Score of every coal shovel and cheers for each new number!" },
  e5: { pair: "Earthmover + Alive", emoji: "🚜", scene: "An earthmover scoops up mud that turns out to be a surprised and very Alive frog!" },
  e6: { pair: "E-scooter + Wicks", emoji: "🛴", scene: "An E-scooter's tires are Wicks that glow softly through every night city ride!" },
  e7: { pair: "Elevator-pod + Heaven", emoji: "🛗", scene: "An elevator pod shoots up so far it pokes through the clouds and arrives in Heaven!" },
  e8: { pair: "Escape-rocket + Slate", emoji: "🚀", scene: "An Escape-rocket wipes the Slate clean of every bad memory and blasts off happy!" },
  f1: { pair: "Fire-engine + Stun", emoji: "🚒", scene: "A Fire-engine's siren is so loud it Stuns every villain into calm sleepy grandma mode!" },
  f2: { pair: "Forklift + Voodoo", emoji: "🏗️", scene: "A Forklift lifts a Voodoo puppet and every warehouse worker starts dancing without knowing why!" },
  f3: { pair: "Flying-saucer + Chimpanzee", emoji: "🛸", scene: "A Flying-saucer lands and a Chimpanzee wearing a spacesuit hands out banana passports!" },
  f4: { pair: "Freight-train + Explore", emoji: "🚂", scene: "A Freight-train loves to Explore every abandoned track and comes home with rusty souvenirs!" },
  f5: { pair: "Funicular + Jive", emoji: "🚞", scene: "A Funicular rocks left and right doing the Jive all the way up the mountain!" },
  f6: { pair: "Formula-one + Sticks", emoji: "🏎️", scene: "A Formula-One car uses Sticks as gearshifts and still wins by three whole laps!" },
  f7: { pair: "Ferry + Coven", emoji: "⛴️", scene: "A Ferry sails to a spooky Coven island and every witch waves cheerfully from the pier!" },
  f8: { pair: "Float-plane + Mate", emoji: "✈️", scene: "A Float-plane finds its true Mate — a rubber duck — and they float together forever!" },
  g1: { pair: "Go-kart + Pun", emoji: "🏎️", scene: "A Go-kart tells a Pun so bad every other kart honks in laughing frustration!" },
  g2: { pair: "Gondola + Igloo", emoji: "🚣", scene: "A Gondola paddles right into a floating Igloo and finds a party of penguins inside!" },
  g3: { pair: "Glider + Referee", emoji: "🛩️", scene: "A Glider is Referee for the sky race and blows a shiny whistle from a puffy white cloud!" },
  g4: { pair: "Garbage-truck + Encore", emoji: "🚛", scene: "A Garbage-truck's beeping backup song is so catchy every neighbour shouts 'Encore!'" },
  g5: { pair: "Gas-balloon + Thrive", emoji: "🎈", scene: "A gas balloon floats over the city and the flowers Thrive as it rains lemonade!" },
  g6: { pair: "Gyrocopter + Bricks", emoji: "🚁", scene: "A Gyrocopter uses Bricks as landing pads and builds itself a tiny brick house every night!" },
  g7: { pair: "Galaxy-ship + Riven", emoji: "🚀", scene: "A Galaxy-ship blasts through a Riven crack in the sky and pops out in another dimension!" },
  g8: { pair: "Giant-robot + Grate", emoji: "🤖", scene: "A Giant-robot squeezes through a manhole Grate to save a kitten and its arm gets stuck!" },
  h1: { pair: "Hovercraft + Shun", emoji: "🛥️", scene: "A Hovercraft can Shun even the biggest wave by simply floating above every splash!" },
  h2: { pair: "Helicopter + Shampoo", emoji: "🚁", scene: "A Helicopter's rotor spins Shampoo bubbles all over town every time it takes off!" },
  h3: { pair: "Hot-rod + Manatee", emoji: "🚗", scene: "A Hot-rod scares a napping Manatee awake and gives it a super speedy joyride!" },
  h4: { pair: "Harvester + War", emoji: "🌾", scene: "A Harvester peacefully ends any farmyard War by scooping up the arguing pigs together!" },
  h5: { pair: "Hoverboard + Chive", emoji: "🛹", scene: "A Hoverboard zips through the herb garden and comes back smelling entirely of Chive!" },
  h6: { pair: "Hydrofoil + Six", emoji: "🚤", scene: "A Hydrofoil skips exactly Six times over each wave like a fancy speed-skimming stone!" },
  h7: { pair: "Hypersonic-jet + Eleven", emoji: "✈️", scene: "A Hypersonic-jet reaches Eleven times the speed of sound and lands in tomorrow morning!" },
  h8: { pair: "Horse-carriage + Skate", emoji: "🐴", scene: "A Horse-carriage puts on Skates and does a graceful pirouette across the frozen pond!" },
};

export interface Theme { id: string; name: string; emoji: string; blurb: string; level: 1 | 2 | 3 | 4 | 5; scenes: Record<string, Scene>; }

/* ---------- Level 1 auto-generation ----------
 * Level 1 = MAXIMUM repetition / simplicity: every square with the same rank uses
 * the same object (Sun/Shoe/Tree/Door/Hive/Sticks/Heaven/Gate). Only the file
 * character varies per theme. Learners memorise 8 characters + 8 objects \u2014 16 things
 * total \u2014 and every one of the 64 squares slots in automatically.
 *
 * A theme at Level 1 is generated from: one character per file (a-h) + the shared
 * EASY_OBJECTS rank map.
 *
 * Higher levels progressively vary the object per file/theme, ending at Level 5
 * (fully unique per theme).
 */
type L1Char = [string, string];  // [name, emoji]
const L1_CHARS: Record<string, Record<string, L1Char>> = {
  // Same as EASY \u2014 kept in sync so both themes render identically at L1.
  easy:  { a: ["Ant","\ud83d\udc1c"], b: ["Bear","\ud83d\udc3b"], c: ["Cat","\ud83d\udc31"], d: ["Dog","\ud83d\udc36"], e: ["Elephant","\ud83d\udc18"], f: ["Fox","\ud83e\udd8a"], g: ["Goat","\ud83d\udc10"], h: ["Horse","\ud83d\udc34"] },
  set1:  { a: ["Angel","\ud83d\udc7c"], b: ["Butterfly","\ud83e\udd8b"], c: ["Cuckoo","\ud83d\udc26"], d: ["Dinosaur","\ud83e\udd95"], e: ["Eagle","\ud83e\udd85"], f: ["Firefly","\u2728"], g: ["Gorilla","\ud83e\udd8d"], h: ["Hawk","\ud83e\udd85"] },
  set2:  { a: ["Arjuna","\ud83c\udff9"], b: ["Bhima","\ud83d\udcaa"], c: ["Chitragupta","\ud83d\udcd6"], d: ["Drona","\ud83c\udf93"], e: ["Ekalavya","\ud83d\udd90\ufe0f"], f: ["Fulara","\ud83c\udf3a"], g: ["Ganesha","\ud83d\udc18"], h: ["Hanuman","\ud83d\udc12"] },
  set3:  { a: ["Apple","\ud83c\udf4e"], b: ["Banana","\ud83c\udf4c"], c: ["Carrot","\ud83e\udd55"], d: ["Doughnut","\ud83c\udf69"], e: ["Egg","\ud83e\udd5a"], f: ["Fig","\ud83c\udf47"], g: ["Garlic","\ud83e\uddc4"], h: ["Honey","\ud83c\udf6f"] },
  set4:  { a: ["Astronaut","\ud83d\udc68\u200d\ud83d\ude80"], b: ["Blackhole","\ud83d\udd73\ufe0f"], c: ["Comet","\u2604\ufe0f"], d: ["Droid","\ud83e\udd16"], e: ["Eclipse","\ud83c\udf11"], f: ["Firestar","\u2b50"], g: ["Galaxy","\ud83c\udf0c"], h: ["Hubble","\ud83d\udd2d"] },
  set5:  { a: ["Anglerfish","\ud83d\udc1f"], b: ["Blowfish","\ud83d\udc21"], c: ["Clownfish","\ud83d\udc20"], d: ["Dolphin","\ud83d\udc2c"], e: ["Eel","\u26a1"], f: ["Flounder","\ud83d\udc1f"], g: ["Giant Squid","\ud83e\udd91"], h: ["Hammerhead","\ud83e\udd88"] },
  set6:  { a: ["Ape","\ud83d\udc35"], b: ["Buffalo","\ud83e\uddac"], c: ["Croc","\ud83d\udc0a"], d: ["Dingo","\ud83d\udc15"], e: ["Elephant","\ud83d\udc18"], f: ["Flamingo","\ud83e\udda9"], g: ["Gorilla","\ud83e\udd8d"], h: ["Hippo","\ud83e\udd9b"] },
  set7:  { a: ["Aladdin","\ud83e\ude94"], b: ["Beast","\ud83e\udd81"], c: ["Cinderella","\ud83d\udc60"], d: ["Dragon","\ud83d\udc09"], e: ["Elf","\ud83e\udddd"], f: ["Fairy","\ud83e\uddda"], g: ["Giant","\ud83c\udf29\ufe0f"], h: ["Hansel","\ud83c\udf6c"] },
  set8:  { a: ["Aquaman","\ud83c\udf0a"], b: ["Batman","\ud83e\udd87"], c: ["Cap","\ud83d\udee1\ufe0f"], d: ["Deadpool","\u2764\ufe0f"], e: ["Ember","\ud83d\udd25"], f: ["Flash","\u26a1"], g: ["Green Lantern","\ud83d\udc9a"], h: ["Hulk","\ud83d\udcaa"] },
  set9:  { a: ["Ash","\ud83c\udfae"], b: ["Bugs","\ud83d\udc30"], c: ["Charlie","\ud83d\ude00"], d: ["Dora","\ud83c\udf92"], e: ["Elmo","\ud83d\udd34"], f: ["Fred","\ud83e\udd95"], g: ["Garfield","\ud83d\udc31"], h: ["Homer","\ud83c\udf69"] },
  set10: { a: ["Airplane","\u2708\ufe0f"], b: ["Bus","\ud83d\ude8c"], c: ["Car","\ud83d\ude97"], d: ["Drone","\ud83d\ude81"], e: ["Excavator","\ud83c\udfd7\ufe0f"], f: ["Firetruck","\ud83d\ude92"], g: ["Golf-cart","\u26f3"], h: ["Helicopter","\ud83d\ude81"] },
};

/** SET1-style rank rosters \u2014 8 objects per rank, indexed by file (a-h).
 *  Used by Levels 2+ for the file-varied but theme-shared object grid. */
const L2_OBJECTS: Record<number, string[]> = {
  1: ["Sun","Bun","Fun","Run","One","Nun","Gun","Swan"],
  2: ["Zoo","Glue","Stew","Moo","Crew","Chew","Blue","Shoe"],
  3: ["Tree","Bee","Key","Sea","Tea","Flea","Ski","Knee"],
  4: ["Door","Floor","Snore","Roar","More","Store","Pour","Boar"],
  5: ["Hive","Dive","Five","Drive","Alive","Jive","Thrive","Chive"],
  6: ["Fix","Bricks","Chicks","Kicks","Tricks","Sticks","Licks","Mix"],
  7: ["Heaven","Eleven","Sky","Head","Sea","Leaven","Dwarfs","Skies"],
  8: ["Gate","Plate","Late","Roar","Skate","Weight","Great","Ate"],
};

/** Theme-specific rank-3 rosters used by Level 3+ (unique per theme for rank 3). */
const L3_RANK3: Record<string, string[]> = {
  easy:  L2_OBJECTS[3]!,                                                   // shared with L2
  set1:  L2_OBJECTS[3]!,                                                   // SET1 is the L2 baseline
  set2:  ["Fee","Ghee","Pea","Chimpanzee","Manatee","Honeybee","Bumblebee","Referee"],
  set3:  ["Wee","Plea","Spree","Glee","Jubilee","Jamboree","Employee","Chickadee"],
  set4:  ["Absentee","Guarantee","Trainee","Devotee","Nominee","Committee","Trustee","TV"],
  set5:  ["Bee","Ghee","Pea","Wee","Fee","Sea","Key","Tea"],
  set6:  ["Fee","Pea","Ghee","Wee","Bee","Sea","Key","Tea"],
  set7:  ["Ghee","Pea","Fee","Wee","Bumblebee","Chimpanzee","Honeybee","Manatee"],
  set8:  ["Fee","Bee","Pea","Ghee","Wee","Sea","Key","Tea"],
  set9:  ["Bee","Sea","Tea","Fee","Ghee","Pea","Wee","Key"],
  set10: ["Bee","Ghee","Pea","Wee","Sea","Fee","Key","Tea"],
};

/** Theme-specific rank-4 rosters used by Level 4+. */
const L4_RANK4: Record<string, string[]> = {
  easy:  L2_OBJECTS[4]!,
  set1:  L2_OBJECTS[4]!,
  set2:  ["Chore","Sore","Bore","Adore","Encore","Score","War","Tore"],
  set3:  ["Core","Explore","Restore","Ignore","Yore","Fore","Gore","Oar"],
  set4:  ["Dinosaur","Corridor","Meteor","Metaphor","Emperor","Sophomore","Furthermore","Nevermore"],
  set5:  ["War","Sore","Score","Chore","Bore","Adore","Encore","Tore"],
  set6:  ["Chore","Sore","Adore","Score","Bore","Explore","Encore","Tore"],
  set7:  ["Chore","Sore","Adore","Score","Bore","Explore","Encore","Tore"],
  set8:  ["Chore","Sore","Adore","Score","Bore","Explore","Encore","Tore"],
  set9:  ["Chore","Sore","Adore","Score","Bore","Explore","Encore","Tore"],
  set10: ["Chore","Sore","Adore","Score","Bore","Explore","Encore","Tore"],
};

/** Build a scene set for one theme at a given level. */
function buildLeveled(themeId: string, level: 1 | 2 | 3 | 4): Record<string, Scene> {
  const chars = L1_CHARS[themeId] ?? L1_CHARS.easy!;
  const out: Record<string, Scene> = {};
  for (let fi = 0; fi < 8; fi++) {
    const f = "abcdefgh"[fi]!;
    const [char, emoji] = chars[f]!;
    for (let r = 1; r <= 8; r++) {
      let obj: string;
      if (level === 1) {
        obj = EASY_OBJECTS[r]!;              // shared object per rank
      } else if (level === 2) {
        obj = L2_OBJECTS[r]![fi]!;           // file-varied, shared across themes
      } else if (level === 3) {
        // L3 = L2 with rank 3 theme-specific
        obj = r === 3 ? (L3_RANK3[themeId] ?? L2_OBJECTS[3]!)[fi]! : L2_OBJECTS[r]![fi]!;
      } else {
        // L4 = L2 + rank 3 + rank 4 theme-specific
        if (r === 3) obj = (L3_RANK3[themeId] ?? L2_OBJECTS[3]!)[fi]!;
        else if (r === 4) obj = (L4_RANK4[themeId] ?? L2_OBJECTS[4]!)[fi]!;
        else obj = L2_OBJECTS[r]![fi]!;
      }
      out[f + r] = {
        pair: `${char} + ${obj}`,
        emoji,
        scene: `Picture the ${char} with the ${obj}. Say it out loud: \u201c${char}\u2026 ${obj}!\u201d`,
      };
    }
  }
  return out;
}

const buildLevel1 = (themeId: string) => buildLeveled(themeId, 1);

// Theme-metadata (used by both L1 and L5 registrations).
interface ThemeMeta { id: string; name: string; emoji: string; blurb: string; }
const THEME_META: ThemeMeta[] = [
  { id: "easy",  name: "Easy Start",       emoji: "\ud83d\udc23", blurb: "Just 8 animals + 8 objects" },
  { id: "set1",  name: "Classic Animals",  emoji: "\ud83d\udc1c", blurb: "Everyday animals being silly" },
  { id: "set2",  name: "Indian Mythology", emoji: "\ud83d\udd49\ufe0f", blurb: "Gods & heroes of the epics" },
  { id: "set3",  name: "Food Chaos",       emoji: "\ud83c\udf69", blurb: "Kitchen & snack silliness" },
  { id: "set4",  name: "Space & Aliens",   emoji: "\ud83d\ude80", blurb: "Astronauts, planets, UFOs" },
  { id: "set5",  name: "Ocean",            emoji: "\ud83d\udc2c", blurb: "Underwater creatures" },
  { id: "set6",  name: "Jungle Safari",    emoji: "\ud83e\udd81", blurb: "Wild jungle animals" },
  { id: "set7",  name: "Fairy Tales",      emoji: "\ud83c\udff0", blurb: "Princesses, dragons, magic" },
  { id: "set8",  name: "Superheroes",      emoji: "\ud83e\uddb8", blurb: "Heroes & superpowers" },
  { id: "set9",  name: "Cartoons",         emoji: "\ud83d\udcfa", blurb: "Beloved cartoon stars" },
  { id: "set10", name: "Vehicles",         emoji: "\ud83d\ude97", blurb: "Cars, trains, planes, robots" },
];

// L5 = the hand-authored per-theme rosters (fully varied within each theme).
// SET1 also plays the role of L5 for "Classic Animals" \u2014 it's the reference set.
const L5_SCENES: Record<string, Record<string, Scene>> = {
  easy: EASY, set1: SET1, set2: SET2, set3: SET3, set4: SET4, set5: SET5,
  set6: SET6, set7: SET7, set8: SET8, set9: SET9, set10: SET10,
};

/** All themes at all supported levels. L2/L3/L4 currently fall back to L5 (the
 *  intermediate blends aren't authored yet). */
export const THEMES: Theme[] = THEME_META.flatMap((m) => {
  const l1 = buildLeveled(m.id, 1);
  const l2 = buildLeveled(m.id, 2);
  const l3 = buildLeveled(m.id, 3);
  const l4 = buildLeveled(m.id, 4);
  const l5 = L5_SCENES[m.id] ?? l4;
  return [
    { ...m, id: `${m.id}-l1`, level: 1 as const, scenes: l1 },
    { ...m, id: `${m.id}-l2`, level: 2 as const, scenes: l2 },
    { ...m, id: `${m.id}-l3`, level: 3 as const, scenes: l3 },
    { ...m, id: `${m.id}-l4`, level: 4 as const, scenes: l4 },
    { ...m, id: `${m.id}-l5`, level: 5 as const, scenes: l5 },
  ];
});

export const themeById = (id: string): Theme => {
  // Back-compat: old ids (like "easy" / "set5") resolve to L5.
  return THEMES.find((t) => t.id === id)
    ?? THEMES.find((t) => t.id === `${id}-l5`)
    ?? THEMES[0]!;
};
export const DEFAULT_THEME_ID = "easy-l1";

// Back-compat: the original single export still points at Set 1.
export const SCENES: Record<string, Scene> = SET1;

// The two noble armies — every piece is a beloved character (not good vs evil).
export interface PieceChar {
  glyph: string;
  role: string;
  name: string;
  feature: string;
  sound: string;
  /** Identifies WHICH of the pair/set this entry represents:
   *   - Knight: "b" (queen-side, b-file) | "g" (king-side, g-file)
   *   - Bishop: "light" (light-square) | "dark" (dark-square)
   *   - Rook:   "a" (queen-side, a-file) | "h" (king-side, h-file)
   *   - Pawn:   "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" (starting file)
   *  undefined = combined/generic entry (fallback / gallery-only). */
  variant?: string;
}

export const WHITE_ARMY: PieceChar[] = [
  { glyph: "♔", role: "King",   name: "Little Krishna", feature: "Blue skin, peacock feather, flute", sound: "Flute note 🎵" },
  { glyph: "♕", role: "Queen",  name: "Hanuman",        feature: "Flying monkey-god, golden mace",  sound: "“Jai Shri Ram!”" },
  { glyph: "♘", role: "Knight", name: "Bheem",          feature: "The b-knight — laddoo-loving strongman on his white horse", sound: "“Dhishoom!”", variant: "b" },
  { glyph: "♘", role: "Knight", name: "Chutki",         feature: "The g-knight — pink-dress girl on her white horse", sound: "“Heehee!”", variant: "g" },
  { glyph: "♗", role: "Bishop", name: "Warrior Arjuna", feature: "The dark-square bishop — battle-hardened Arjuna, Gandiva bow", sound: "Bowstring “TWANG!”", variant: "dark" },
  { glyph: "♗", role: "Bishop", name: "Young Arjuna",   feature: "The light-square bishop — young Arjuna, Gandiva bow",    sound: "Arrow whistle",   variant: "light" },
  { glyph: "♖", role: "Rook",   name: "Dholu",  feature: "The a-file (queen-side) rook — riding a white elephant", sound: "“Hehehe!”",  variant: "a" },
  { glyph: "♖", role: "Rook",   name: "Bholu",  feature: "The h-file (king-side) rook — riding a white elephant",   sound: "“Hehehe!”",  variant: "h" },
  { glyph: "♙", role: "Pawn",   name: "8 Minions",      feature: "Yellow, brave; promote into Hanuman!", sound: "“Banana!”" },
];

export const BLACK_ARMY: PieceChar[] = [
  { glyph: "♚", role: "King",   name: "Lord Shiva",    feature: "Trident, crescent moon, meditation pose", sound: "“Om” / temple bell" },
  { glyph: "♛", role: "Queen",  name: "Nandi",         feature: "Sacred bull, golden bells", sound: "“Mooooo” + bells" },
  { glyph: "♞", role: "Knight", name: "Tom",           feature: "The b-knight — sneering cat on his dark horse", sound: "Cat sneer", variant: "b" },
  { glyph: "♞", role: "Knight", name: "Jerry",         feature: "The g-knight — cheeky mouse on his dark horse", sound: "“Eek eek!”", variant: "g" },
  { glyph: "♝", role: "Bishop", name: "Warrior Karna", feature: "The dark-square bishop — battle-hardened Karna, Vijaya bow", sound: "Arrow “FWOOSH!”", variant: "dark" },
  { glyph: "♝", role: "Bishop", name: "Young Karna",   feature: "The light-square bishop — young Karna, Vijaya bow",     sound: "Bowstring “TWANG!”", variant: "light" },
  { glyph: "♜", role: "Rook",   name: "Motu",   feature: "The a-file (queen-side) rook — riding a dark elephant", sound: "“Samosa!”",          variant: "a" },
  { glyph: "♜", role: "Rook",   name: "Patlu",  feature: "The h-file (king-side) rook — riding a dark elephant",   sound: "“Motu, careful!”",  variant: "h" },
  { glyph: "♟", role: "Pawn",   name: "8 Lilliputs",   feature: "Tiny medieval warriors", sound: "Marching “Hup hup hup!”" },
];

export const ALL_SQUARES: string[] = (() => {
  const out: string[] = [];
  for (const f of "abcdefgh") for (let r = 1; r <= 8; r++) out.push(f + r);
  return out;
})();

// Light/dark colour of a square, for styling.
export const isLightSquare = (sq: string): boolean => {
  const file = sq.charCodeAt(0) - 97; // a=0
  const rank = Number(sq[1]) - 1;
  return (file + rank) % 2 === 1;
};
