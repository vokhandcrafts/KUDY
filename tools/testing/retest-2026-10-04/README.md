# Уваходныя кропкі паўторнай праверкі main ад 2026-10-04

Параметрызаваныя ўваходныя кропкі для наступнікаў па справаздачы ад 4 кастрычніка:
[#591](https://github.com/vokhandcrafts/KUDY/issues/591) (Windows-шляхі ў праверцы мовы
дакумента) і [#592](https://github.com/vokhandcrafts/KUDY/issues/592) (аднаўленне
паўторнай Android-зборкі). Эпік: [#532](https://github.com/vokhandcrafts/KUDY/issues/532).

Гістарычныя доказы прагону — пінутыя іх не рэгенерыраваць і не перазапісваць:
справаздача `docs/testing/2026-10-04-main-retest.md`, evidence
`docs/testing/evidence/2026-10-04-retest/` (урахаванаю мадэль лічбаў гл. у справаздачы).

## Вэб (#591)

Кантракт мовы дакумента — `web/lib/content/exported-language.ts`; гэта адзіная крыніца
праўды, нічога яго не дублюе.

- Рэпрадуктар адзіночнай паводзіны (да выпраўлення #591 заканчваецца кодам 1):
  `node --experimental-strip-types docs/testing/evidence/2026-10-04-retest/reproduce-document-language.mjs`
- Паводзінныя праверкі кантракту:
  `node --test --experimental-strip-types web/lib/content/exported-language.test.ts`
- Поўны скан рэндэру ўваходзіць у зборку: `npm --prefix web run build`
  (выклікае `web/scripts/scan-rendered.ts` па `web/out/`). Асобны скан — той самы сцэнар,
  патрабуе гатовага `web/out/`.

## Android (#592)

1. `powershell -File tools/testing/retest-2026-10-04/android-env.ps1` — скоп
   працэснага асяроддзя SDK/JDK/Gradle/кэшаў. Корань задае выканаўца праз
   `KUDY_ANDROID_HOME` (апцыянальна `KUDY_JAVA_HOME`, `KUDY_GRADLE_USER_HOME`,
   `KUDY_ANDROID_USER_HOME`); ніякіх дарожак пэўнай машыны ў файле няма.
2. `. .\tools\testing\retest-2026-10-04\android-ui-helpers.ps1 -EvidenceDir <тэчка>`
   — хелперы dump/screencap/tap для эмулятара: абмежаванае чаканне прылады, усе
   памылкі adb падымаюцца выключэннем, serial задае `KUDY_DEVICE_SERIAL`.

## Чаго тут свядома няма

Арыгінальныя scratch-хелперы з Windows-checkout (перанос build-тэчак у бэкапы з
junction-амі, сцэнарыныя навігацыйныя скрыпты, разавыя summarizer-ы) не перанесеныя:
яны маюць дарожкі пэўнай машыны і робяць мутацыі build-каталогаў. Аднаўленне
бяспечнага clean-up — частка крытэраў #592, а не гэтай публікацыі.
