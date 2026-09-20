# Follow-up PR #133 [Low] — дыягностыкі гейтаў interim-catalog экрануюць кіравальныя сімвалы

Дэма правярае фікс Low-знаходкі рэвью PR #133 (issue #134): адхіленае
дрэва-кантраляванае імя больш не трапляе ў тэкст `unsafe bundle entry
name: …` як ёсць — кіравальныя сімвалы рэндэрацца як `\uXXXX`, таму
дырэкторыя з пераводам радка ў імі больш не ломіць структуру радка
дыягностыкі. Семантыка гейтаў незменная.

Лякал з `\n` у імі — экранаваная дыягностыка, сыр \n у паведамленні
адсутнічае:

```sh
node --experimental-strip-types -e "Promise.all([import('./web/lib/content/test-fixture.ts'),import('./web/lib/content/interim-catalog.ts')]).then(async([f,c])=>{const fs=await import('node:fs');const path=await import('node:path');const {publicRoot}=await f.buildDemoFixture();fs.mkdirSync(path.join(publicRoot,'bundle','demo-route-a1','1','bad\nname'),{recursive:true});try{c.deriveInterimCatalog(publicRoot)}catch(e){const raw=e.message.includes(String.fromCharCode(10));console.log('diagnostic:',e.message);console.log('raw-newline-in-message:',raw)}})"
```

```output
diagnostic: unsafe bundle entry name: bundle/demo-route-a1/1/bad\u000aname
raw-newline-in-message: false
```

Той самы хэлпер на route-узроўні (`bad\nroute`):

```sh
node --experimental-strip-types -e "Promise.all([import('./web/lib/content/test-fixture.ts'),import('./web/lib/content/interim-catalog.ts')]).then(async([f,c])=>{const fs=await import('node:fs');const path=await import('node:path');const {publicRoot}=await f.buildDemoFixture();fs.mkdirSync(path.join(publicRoot,'bundle','bad\nroute'));try{c.deriveInterimCatalog(publicRoot)}catch(e){console.log('diagnostic:',e.message)}})"
```

```output
diagnostic: unsafe bundle entry name: bundle/bad\u000aroute
```

Не-кіравальны non-identifier (`bad name`) і `'..'` адхіляюцца як раней —
сімвалы, якія не трэба экранаваць, застаюцца чытэльнымі:

```sh
node --experimental-strip-types -e "Promise.all([import('./web/lib/content/test-fixture.ts'),import('./web/lib/content/interim-catalog.ts')]).then(async([f,c])=>{const fs=await import('node:fs');const path=await import('node:path');const {publicRoot}=await f.buildDemoFixture();fs.mkdirSync(path.join(publicRoot,'bundle','bad name'));try{c.deriveInterimCatalog(publicRoot)}catch(e){console.log('diagnostic:',e.message)}})"
```

```output
diagnostic: unsafe bundle entry name: bundle/bad name
```

Поўны boundary-набор у дэфолтным `npm test` (9 старых + 2 новыя
кіравальна-сімвальныя):

```sh
node --test --experimental-strip-types --test-reporter=tap --test-concurrency=1 web/lib/content/entry-boundary.test.ts 2>&1 | grep -E '^# (tests|pass|fail)'
```

```output
# tests 11
# pass 11
# fail 0
```
