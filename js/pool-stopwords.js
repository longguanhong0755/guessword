// GENERATED from functions/api/_pool-stopwords.js by build/sync-stopwords.mjs — do not edit.
/* =====================================================================
   Shared "not a semantic target" vocabulary for GuessWord.

   This file is the single source of truth for two things that must be
   identical in the browser (js/app.js), the online engine
   (functions/api/_engine.js) and the parity reference
   (build/parity-ref.mjs):

     1. POOL_STOP — closed-class words (articles, pronouns, auxiliaries,
        prepositions, conjunctions, quantifiers, numbers, greetings and
        other function-like tokens). They are excluded from the ranking
        pool, from hints and from secret selection. They can still be
        *guessed* offline for ranking, but the UI rejects them up front.

     2. BLOCKED — hard-blocked English stems (never a secret, never a
        suggestion).

   It has no imports and no browser/Node APIs, so the build can inline it
   into the single-file client script (build/compose.mjs strips the
   `export` keywords) while Cloudflare Pages Functions import it as an
   ES module.
   ===================================================================== */

function setOf(s) {
  return new Set(s.trim().split(/\s+/));
}

// add forms to an existing set (used for full verb paradigms below)
function addAll(set, s) {
  for (const w of s.trim().split(/\s+/)) set.add(w);
}

const POOL_STOP = {
  en: setOf(`
    a an the this that these those my your his her its our their some any no
    every each all both either neither another other such what which whose
    i me mine myself you yours yourself yourselves he him himself she hers
    herself it itself we us ours ourselves they them theirs themselves who
    whom am is are was were be been being have has had having do does did
    doing done will would shall should can could may might must ought
    about above across after against along among around at before behind
    below beneath beside between beyond by down during except for from in
    inside into like near of off on onto out outside over past since through
    throughout till to toward under underneath until up upon with within
    without and but or nor so yet because if then than though although while
    whereas unless as not never always often sometimes usually seldom
    rarely already still just only even ever almost enough quite rather too
    very now here there when where why how again once soon later perhaps
    maybe zero one two three four five six seven eight nine ten eleven
    twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen
    twenty thirty forty fifty sixty seventy eighty ninety hundred thousand
    million billion oh ah eh hey hi hello bye thanks thank please yes yeah
    ok okay cannot gonna wanna gotta mr mrs ms dr
  `),
  fr: setOf(`
    le la les l un une des du de d au aux ce cet cette ces mon ma mes ton ta
    tes son sa ses notre nos votre vos leur leurs quel quelle quels quelles
    chaque plusieurs quelques aucun aucune autre autres tout tous toute
    toutes même mêmes je tu il elle on nous vous ils elles me te se moi toi
    lui eux y en ça cela ceci celui celle ceux celles qui que quoi dont où
    être suis es est sommes êtes sont étais était étions étaient été ai as a
    avons avez ont avais avait avions avaient aurai aurais aura auraient
    avoir fais fait faisons faites font faisais faisait ferai ferais faire
    faut fallait peut peux pouvez peuvent pouvait pouvais pourrai pourrais
    veut veux voulez veulent voulait voulais voudrais dois doit devez
    doivent devait devais devrait va vas allons allez vont allais allait
    irai ira vient viens venez viennent venait venais viendra sais sait
    savez savent savais savait dit vu pu pris mis et ou mais donc or ni car
    si comme quand parce puisque cependant pourtant ainsi alors aussi très
    plus moins trop bien mal pas ne non oui encore déjà toujours jamais
    souvent parfois ici là maintenant aujourd'hui hier demain avant après
    avec sans sous sur dans entre chez vers par pour pendant depuis jusque
    contre malgré selon beaucoup peu assez tellement vraiment peut-être
    presque environ seulement surtout enfin zéro deux trois quatre cinq six
    sept huit neuf dix onze douze treize quatorze quinze seize vingt trente
    quarante cinquante soixante cent mille oh ah eh hé ben euh ouais ok
    bonjour salut merci pardon désolé désolée monsieur madame mademoiselle
    mme m dr
  `),
  de: setOf(`
    der die das den dem des ein eine einen einem einer eines kein keine
    keinen keinem keiner dieser diese dieses diesen diesem jene jener jedes
    jeder jede alle alles ich du er sie es wir ihr mich dich ihn uns euch
    mir dir ihm ihnen sich man wer was wen wem wessen jemand niemand etwas
    nichts sein bin bist ist sind seid war waren wäre wären gewesen habe
    hast hat haben habt hatte hatten hätte hätten werde wirst wird werden
    werdet wurde wurden würde würden kann kannst können konnte konnten
    könnte mögen mag möchte muss musst müssen musste mussten sollte sollst
    sollen will willst wollen wollte wollten darf darfst dürfen durfte
    lassen lasse lässt tun tue tust tut gemacht machen mache machst macht
    machte und oder aber denn sondern wenn weil dass ob als wie damit obwohl
    nachdem bevor während bis seit für mit ohne gegen über unter zwischen
    durch um zu zum zur vom beim im am ans auf aus bei von vor hinter neben
    in an hin her hier da dort dann wann wo warum wieso weshalb nicht nein
    ja doch schon noch nur auch sehr so viel wenig mehr minder meist oft
    immer nie niemals wieder gern gerne bald jetzt nun heute gestern
    deshalb deswegen trotzdem allerdings jedoch eigentlich etwa fast ganz
    ziemlich null eins zwei drei vier fünf sechs sieben acht neun zehn elf
    zwölf zwanzig dreißig hundert tausend oh ah ach na ne hey hallo tschüss
    danke bitte okay ok
  `),
  es: setOf(`
    el la los las lo un una unos unas este esta estos estas ese esa esos
    esas aquel aquella aquellos aquellas mi mis tu tus su sus nuestro
    nuestra nuestros nuestras yo tú usted él ella nosotros nosotras ustedes
    ellos ellas me te se nos os le les mí ti sí conmigo contigo quién qué
    cual cuales cuanto cuanta cuánto cuánta ser soy eres es somos sois son
    era eran fue fueron sido estar estoy estás está estamos están estaba
    estaban estado haber he has ha hemos han había habían hay hacer hago
    haces hace hacemos hacen hizo hecho tener tengo tienes tiene tenemos
    tienen tenía poder puedo puedes puede podemos pueden podía querer
    quiero quieres quiere queremos quieren quería ir voy vas va vamos van
    iba saber sé sabes sabe sabemos saben sabía decir digo dices dice
    decimos dicen dijo deber debo debes debe debemos deben debería venir
    vengo vienes viene venimos vienen vino ver veo ves ve vemos ven vio dar
    doy das da damos dan dio y e o u pero sino porque que como cuando donde
    si aunque mientras pues entonces también tampoco muy más menos mucho
    muchos mucha muchas poco pocos poca pocas todo toda todos todas otro
    otra otros otras mismo misma ya todavía aún siempre nunca jamás ahora
    antes después luego aquí allí ahí cerca lejos bien mal así solo sólo no
    ni claro vale cero uno dos tres cuatro cinco seis siete ocho nueve diez
    once doce trece catorce quince veinte treinta cien ciento mil hola
    adiós gracias perdón oye eh ok señor señora señorita don doña
  `),
  ja: setOf(`
    私 あなた 彼 彼女 これ それ あれ どれ この その あの どの ここ そこ
    あそこ どこ こちら そちら あちら どちら こっち そっち あっち どっち
    こんな そんな あんな どんな ある いる なる する だ です ます ない
    しかし じゃ では でも また まだ もう そして それから それでは
    そうして なぜ どう どうして どうぞ どうも あまり いちばん いつも
    すぐ すぐに 少し ちょっと たくさん たぶん ちょうど だんだん 時々
    とても もっと よく もう一度 など より ほど だけ しか ばかり 何 誰
    いつ いくつ いくら どなた はい いいえ ええ さあ ありがとう おはよう
    こんにちは こんばんは さようなら すみません ごめんなさい お願いします
    いただきます 一 二 三 四 五 六 七 八 九 十 百 千 万 ゼロ 零
    で と ね あ こと つもり いずれ あるいは たいてい やがて しばらく
    ほとんど つまり もっとも おそらく ぜひ きっと やはり かなり ずいぶん
    為 等 様 君 僕 俺 否 可 方 所 時 物 点 度 分 者 他 全 半 毎 数
  `),
  ko: setOf(`
    나 저 너 우리 그 그녀 이것 그것 저것 여기 거기 저기 어디 어느 누구
    무엇 뭐 언제 왜 어떻게 무슨 몇 이 그 저 제 이다 아니다 있다 없다 하다
    되다 계시다 그렇다 이렇다 저렇다 어떻다 그리고 그런데 그래서 그러니까
    그렇지만 하지만 그러나 또 다시 자주 가끔 모두 아주 정말 매우 너무 좀
    잘 빨리 일찍 먼저 나중 이제 요즘 언제나 아직 아마 바로 함께 같이
    제일 가장 많이 네 예 아니요 아니오 안녕하세요 안녕 감사합니다
    고맙습니다 죄송합니다 미안합니다 반갑다 하나 둘 셋 넷 다섯 여섯 일곱
    여덟 아홉 열 일 이 삼 사 오 육 칠 팔 구 십 백 천 만 영 공
    의 도 다 더 매일
  `),
};

/* ---------- generated paradigms ----------
   Frequency-banded packs keep inflected forms as separate tokens, so a hand
   list of "common" function words misses whole tenses (e.g. fr "auriez",
   de "meine", es "haré"). Those forms are never useful secrets or hints, and
   they must be filtered identically on the client and the server, so the
   full auxiliary/modal paradigms are added here instead of in the literals
   above. Content verbs keep their inflection (a conjugated verb is still a
   meaningful answer). */
addAll(POOL_STOP.fr, `
  suis es est sommes êtes sont étais était étions étiez étaient serai seras
  sera serons serez seront serais serait serions seriez seraient sois soit
  soyons soyez soient fus fut fûmes fûtes furent été
  ai as a avons avez ont avais avait avions aviez avaient aurai auras aura
  aurons aurez auront aurais aurait aurions auriez auraient aie aies ait
  ayons ayez aient eus eut eûmes eûtes eurent eu
  vais vas va allons allez vont allais allait allions alliez allaient irai
  iras ira irons irez iront irais irait irions iriez iraient aille ailles
  aillent allai allas alla allâmes allâtes allèrent allé allée allés allées
  fais fait faisons faites font faisais faisait faisions faisiez faisaient
  ferai feras fera ferons ferez feront ferais ferait ferions feriez feraient
  fasse fasses fassent fis fit fîmes fîtes firent faite faits faites
  peux peut pouvons pouvez peuvent pouvais pouvait pouvions pouviez
  pouvaient pourrai pourras pourra pourrons pourrez pourront pourrais
  pourrait pourrions pourriez pourraient puisse puisses puissent pus put
  pûmes pûtes purent pu
  veux veut voulons voulez veulent voulais voulait voulions vouliez
  voulaient voudrai voudras voudra voudrons voudrez voudront voudrais
  voudrait voudrions voudriez voudraient veuille veuilles veuillent voulus
  voulut voulûmes voulûtes voulurent voulu
  dois doit devons devez doivent devais devait devions deviez devaient
  devrai devras devra devrons devrez devront devrais devrait devrions
  devriez devraient doive doives doivent dus dut dûmes dûtes durent dû due
  dus dues
  sais sait savons savez savent savais savait savions saviez savaient saurai
  sauras saura saurons saurez sauront saurais saurait saurions sauriez
  sauraient sache saches sachent sus sut sûmes sûtes surent su
  faut fallait faudra faudrait faudrons faudrez faudront faudrais faudrait
  faille fallu
`);

addAll(POOL_STOP.de, `
  bin bist ist sind seid war warst wart waren wärt wäre wärst wären gewesen
  habe hast hat haben habt hatte hattest hatten hattet hätte hättest hätten
  hättet gehabt
  werde wirst wird werden werdet wurde wurdest wurden wurdet würde würdest
  würden würdet geworden
  derer dessen deren denen wem wen wessen
  mein meine meiner meines meinem meinen dein deine deiner deines deinem
  deinen sein seine seiner seines seinem seinen unser unsere unserer
  unseres unserem unseren euer eure eurer eures eurem euren ihr ihre ihrer
  ihres ihrem ihren
  irgendjemand irgendwer irgendwas irgendwo irgendwohin jemandem jemanden
  jemandes niemandem niemanden niemandes seins
`);

addAll(POOL_STOP.es, `
  seré serás será seremos seréis serán sería serías seríamos seríais serían
  sea seas sean seamos seáis fui fuiste fue fuimos fuisteis fueron fuera
  fueras fueran fuéramos fuerais fuese fueses fuesen fuésemos fueseis
  estaré estarás estará estaremos estaréis estarán estaría estarías
  estaríamos estaríais estarían esté estés estén estemos estéis estuve
  estuviste estuvo estuvimos estuvisteis estuvieron estuviera estuvieras
  estuvieran estuviéramos estuvierais estuviese estuvieses estuviesen
  estuviésemos estuvieseis
  habré habrás habrá habremos habréis habrán habría habrías habríamos
  habríais habrían haya hayas hayan hayamos hayáis hube hubiste hubo
  hubimos hubisteis hubieron hubiera hubieras hubieran hubiéramos hubierais
  hubiese hubieses hubiesen hubiésemos hubieseis
  tendré tendrás tendrá tendremos tendréis tendrán tendría tendrías
  tendríamos tendríais tendrían tenga tengas tengan tengamos tengáis tuve
  tuviste tuvo tuvimos tuvisteis tuvieron tuviera tuvieras tuvieran
  tuviéramos tuvierais tuviese tuvieses tuviesen tuviésemos tuvieseis
  iré irás irá iremos iréis irán iría irías iríamos iríais irían vaya vayas
  vayan vayamos vayáis
  haré harás hará haremos haréis harán haría harías haríamos haríais harían
  haga hagas hagan hagamos hagáis hice hiciste hizo hicimos hicisteis
  hicieron hiciera hicieras hicieran hiciéramos hicierais hiciese hicieses
  hiciesen hiciésemos hicieseis
  podré podrás podrá podremos podréis podrán podría podrías podríamos
  podríais podrían pueda puedas puedan podamos podáis pude pudiste pudo
  pudimos pudisteis pudieron pudiera pudieras pudieran pudiéramos pudierais
  pudiese pudieses pudiesen pudiésemos pudieseis
  querré querrás querrá querremos querréis querrán querría querrías
  querríamos querríais querrían quiera quieras quieran queramos queráis
  quise quisiste quiso quisimos quisisteis quisieron quisiera quisieras
  quisieran quisiéramos quisierais quisiese quisieses quisiesen
  quisiésemos quisieseis
  sabré sabrás sabrá sabremos sabréis sabrán sabría sabrías sabríamos
  sabríais sabrían sepa sepas sepan sepamos sepáis supe supiste supo
  supimos supisteis supieron supiera supieras supieran supiéramos supierais
  supiese supieses supiesen supiésemos supieseis
  diré dirás dirá diremos diréis dirán diría dirías diríamos diríais dirían
  diga digas digan digamos digáis dije dijiste dijo dijimos dijisteis
  dijeron dijera dijeras dijeran dijéramos dijerais dijese dijeses dijesen
  dijésemos dijeseis
  deberé deberás deberá deberemos deberéis deberán debería deberías
  deberíamos deberíais deberían deba debas deban debamos debáis debí
  debiste debió debimos debisteis debieron debiera debieras debieran
  debiéramos debierais debiese debieses debiesen debiésemos debieseis
  vendré vendrás vendrá vendremos vendréis vendrán vendría vendrías
  vendríamos vendríais vendrían venga vengas vengan vengamos vengáis vine
  viniste vino vinimos vinisteis vinieron viniera vinieras vinieran
  viniéramos vinierais viniese vinieses viniesen viniésemos vinieseis
  veré verás verá veremos veréis verán vería verías veríamos veríais verían
  vea veas vean veamos veáis vi viste vio vimos visteis vieron viera vieras
  vieran viéramos vierais viese vieses viesen viésemos vieseis
  daré darás dará daremos daréis darán daría darías daríamos daríais darían
  dé des den demos deis di diste dio dimos disteis dieron diera dieras
  dieran diéramos dierais diese dieses diesen diésemos dieseis
`);

const BLOCKED = [
  "rape", "rapes", "retard", "retards", "nigga", "niggas", "nigger",
  "niggers", "faggot", "faggots", "negro", "coon", "kike", "spastic",
];

function isStopWord(lang, word) {
  const set = POOL_STOP[lang];
  return !!set && set.has(word);
}

function isBlocked(word) {
  return BLOCKED.some((b) => word.startsWith(b));
}
