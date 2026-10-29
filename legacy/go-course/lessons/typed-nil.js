COURSE.lessons['typed-nil'] = {
  time: '~30 мин',
  lead: 'Почему функция, вернувшая «nil», проходит проверку err != nil, и когда сравнение двух интерфейсов роняет программу.',

  simple: [
    'Хендлер вызывает сервис. Сервис ничего плохого не нашёл и «вернул nil», а хендлер всё равно отвечает клиенту 500. В логе ошибки — «&lt;nil&gt;». Это один из самых частых прод-багов в Go, и о нём спрашивают почти на каждом собесе.',
    'Причина в том, что интерфейс равен nil, только если пусты обе его половины — и тип, и данные. Если функция вернула nil-указатель конкретного типа, тип в интерфейсе записан, и это уже не nil.',
    '<b>Как сказать на собесе:</b> «Интерфейс равен nil, только когда и тип, и значение nil. Если вернуть nil-указатель конкретного типа как error, получится typed nil, и err != nil будет true. Поэтому в ветке без ошибки возвращают nil литералом».'
  ],

  blocks: [
    { h: 'Проблема: nil, который не nil' },
    { p: 'Это самый частый вопрос на Go-собеседованиях. Посмотри на функцию:' },
    { code: 'type NotFound struct{ ID int }\n\nfunc (e *NotFound) Error() string { return fmt.Sprintf("товар %d не найден", e.ID) }\n\nfunc find(id int) error {\n    var err *NotFound\n    if id < 0 {\n        err = &NotFound{ID: id}\n    }\n    return err\n}\n\nfunc main() {\n    if err := find(5); err != nil {\n        fmt.Println("ошибка!")   // <- выполнится\n    }\n}' },
    { p: 'Для <code>id = 5</code> ошибка не создаётся, переменная <code>err</code> остаётся nil-указателем, и функция её возвращает. Кажется, что <code>err != nil</code> должно быть ложным. Но программа печатает «ошибка!».' },

    { h: 'Почему так: интерфейс сравнивается целиком' },
    { p: 'Из урока 12 ты знаешь: интерфейс — это два слова, тип и данные. Правило сравнения с nil:' },
    { note: 'Интерфейс равен nil, только если пусты <b>обе</b> половины — и тип, и данные. Такой интерфейс называется {{nil-iface}}. Это его {{zero-value|нулевое значение}}.', title: 'Правило' },
    { p: 'Когда функция возвращает <code>err</code> типа <code>*NotFound</code>, Go строит значение типа <code>error</code>: в первое слово записывает тип <code>*NotFound</code>, во второе — nil-указатель. Тип записан — значит, интерфейс не nil. Это и есть {{typed-nil}}.' },
    { scheme: {
      title: 'Три разных error',
      html:
        '<div class="diagram"><div class="d-row">' +
          '<div class="d-box ok"><div class="t">return nil</div><div class="words"><div>тип<small>пусто</small></div><div>данные<small>пусто</small></div></div><div class="s">err == nil → <b>true</b></div></div>' +
          '<div class="d-box bad"><div class="t">return err, где err — nil *NotFound</div><div class="words"><div>тип<small>*NotFound</small></div><div>данные<small>nil</small></div></div><div class="s">err == nil → <b>false</b></div></div>' +
          '<div class="d-box"><div class="t">return &NotFound{ID: -1}</div><div class="words"><div>тип<small>*NotFound</small></div><div>данные<small>0xc000…</small></div></div><div class="s">err == nil → <b>false</b></div></div>' +
        '</div></div>',
      cap: 'Посередине — typed nil. Он ведёт себя как настоящая ошибка, хотя внутри ничего нет.'
    } },
    { anim: {
      title: 'Как return err превращается в не-nil',
      w: 700, h: 260,
      els: [
        { id: 'ev', kind: 'box', x: 10, y: 40, w: 180, h: 110, t: 'var err *NotFound', s: '= nil' },
        { id: 'il', kind: 'label', x: 400, y: 28, t: 'error, который вернула find', cls: 'mut' },
        { id: 'it', kind: 'box', x: 290, y: 40, w: 110, h: 70, t: 'тип', s: '—' },
        { id: 'id', kind: 'box', x: 400, y: 40, w: 110, h: 70, t: 'данные', s: '—' },
        { id: 'nl', kind: 'label', x: 400, y: 240, t: 'nil-интерфейс', cls: 'mut', hide: true },
        { id: 'nt', kind: 'box', x: 290, y: 155, w: 110, h: 70, t: 'тип', s: '—', hide: true },
        { id: 'nd', kind: 'box', x: 400, y: 155, w: 110, h: 70, t: 'данные', s: '—', hide: true },
        { id: 'tT', kind: 'tok', x: 62, y: 125, t: '*NotFound' },
        { id: 'tD', kind: 'tok', x: 150, y: 125, t: 'nil' },
        { id: 'mT', kind: 'mark', x: 345, y: 143, t: '≠', cls: 'bad', hide: true },
        { id: 'mD', kind: 'mark', x: 455, y: 143, t: '=', cls: 'ok', hide: true },
        { id: 'r1', kind: 'label', x: 530, y: 120, t: 'не равны', cls: 'bad', anchor: 'start', hide: true },
        { id: 'r2', kind: 'label', x: 530, y: 146, t: 'err != nil → true', cls: 'bad', anchor: 'start', hide: true }
      ],
      steps: [
        { cap: '<code>find(5)</code>: ветка с ошибкой не выполнилась. Переменная <code>err</code> имеет тип <code>*NotFound</code> и значение nil.',
          set: { ev: { cls: 'hot' } } },
        { cap: '<code>return err</code>: функция обещала вернуть <code>error</code>, и Go упаковывает указатель в интерфейс. В первое слово записывается тип <code>*NotFound</code>, во второе — nil.',
          set: { tT: { x: 345, y: 88 }, tD: { x: 455, y: 88 }, it: { s: '', cls: 'hot' }, id: { s: '' } } },
        { cap: '<code>err != nil</code> сравнивает это значение с nil-интерфейсом. У nil-интерфейса пусты обе половины.',
          set: { nl: { show: 1 }, nt: { show: 1 }, nd: { show: 1 } } },
        { cap: 'Сравниваются обе половины. Первая уже не совпала: <code>*NotFound</code> против пустоты. Значит, интерфейсы не равны, <code>err != nil</code> даёт true, и код идёт по ветке ошибки.',
          set: { it: { cls: 'bad' }, mT: { show: 1 }, r1: { show: 1 }, r2: { show: 1 } } },
        { cap: 'Данные при этом совпадают: nil и nil. Но это уже неважно — для равенства нужны обе половины.',
          set: { mD: { show: 1 }, id: { cls: 'ok' } } },
        { cap: 'А вот <code>return nil</code>: обе половины пусты, как у nil-интерфейса, и сравнение даёт равенство. Поэтому в ветке «ошибки нет» всегда пиши <code>return nil</code>.',
          set: { tT: { show: 0 }, tD: { show: 0 }, it: { s: '—', cls: 'ok' }, id: { s: '—', cls: 'ok' }, mT: { t: '=', cls: 'ok' },
                 r1: { t: 'равны', cls: 'ok' }, r2: { t: 'err == nil', cls: 'ok' }, ev: { t: 'return nil', s: '', cls: 'ok' } } }
      ]
    } },
    { cs: 'В C# <code>object o = (string)null;</code> — и <code>o == null</code> даст <b>true</b>: ссылка просто нулевая, типа у неё нет. Поэтому у разработчиков из C# здесь интуиция ломается чаще всего. В Go интерфейс — не ссылка, а пара (тип, данные), и тип сохраняется даже при nil-данных.' },

    { h: 'Почему это так сложно заметить' },
    { p: 'Если напечатать такую ошибку, увидишь вот это:' },
    { code: 'err := find(5)\nfmt.Println(err == nil) // false\nfmt.Println(err)        // <nil>', cap: 'Проверено на Go 1.26. Метод Error() обращается к e.ID на nil-указателе и паникует; fmt перехватывает такую панику у nil-указателей и печатает «<nil>».' },
    { p: 'Печать говорит «nil», сравнение говорит «не nil». В логах всё выглядит нормально, а код идёт по ветке ошибки. Поэтому такие баги живут неделями.' },
    { p: 'Ещё одна деталь: метод на nil-указателе — это не обязательно паника. Если метод не трогает поля, он спокойно работает:' },
    { code: 'type Quiet struct{}\n\nfunc (q *Quiet) Error() string { return "тихая ошибка" }\n\nvar q *Quiet\nfmt.Println(q.Error()) // тихая ошибка' },
    { p: 'Именно поэтому Go и не может считать typed nil «пустым»: значение с типом, но без данных — вполне рабочее значение, у которого можно вызывать методы.' },

    { h: 'Вызов метода через интерфейс с nil' },
    { p: 'Вызов метода у интерфейса, в котором «что-то nil», ведёт себя по-разному. Это три разных случая, и на собесах их проверяют задачами:' },
    { table: { head: ['Что в интерфейсе', 'Ресивер метода', 'Что будет'], rows: [
      ['ничего — nil-интерфейс', 'любой', '<b>паника</b>: нет типа, значит нет itab, и вызывать нечего'],
      ['typed nil: тип <code>*T</code>, данные nil', 'указательный <code>*T</code>', 'метод вызывается с ресивером nil. Работает, если не трогает поля'],
      ['typed nil: тип <code>*T</code>, данные nil', 'значимый <code>T</code>', '<b>паника</b>: чтобы передать копию T, нужно прочитать память по адресу nil']
    ] } },
    { p: 'Третий случай — задача с собеса Napoleon IT:' },
    { code: 'type Doer interface{ do() }\ntype Object struct{ name string }\n\nfunc (o Object) do() { fmt.Println("do:", o.name) }\n\nvar o *Object\nvar d Doer = o\nfmt.Println(d == nil) // false\nd.do()\n// panic: runtime error: invalid memory address or nil pointer dereference', cap: 'Проверено на Go 1.26. Эта задача есть в твоём задании — предсказание 5.' },
    { anim: {
      title: 'Почему typed nil со значимым ресивером паникует',
      w: 640, h: 275,
      els: [
        { id: 'il', kind: 'label', x: 140, y: 28, t: 'var d Doer', cls: 'mut' },
        { id: 'it', kind: 'box', x: 20, y: 40, w: 120, h: 64, t: 'тип', s: '*Object' },
        { id: 'id', kind: 'box', x: 140, y: 40, w: 120, h: 64, t: 'данные', s: '' },
        { id: 'tok', kind: 'tok', x: 200, y: 88, t: 'nil' },
        { id: 'fv', kind: 'box', x: 360, y: 20, w: 260, h: 64, t: 'func (o Object) do()', s: 'ресивер — значение' },
        { id: 'fp', kind: 'box', x: 360, y: 170, w: 260, h: 64, t: 'func (o *Object) do()', s: 'ресивер — указатель', hide: true },
        { id: 'a1', kind: 'arrow', x1: 262, y1: 60, x2: 357, y2: 52, hide: true },
        { id: 'a2', kind: 'arrow', x1: 262, y1: 84, x2: 357, y2: 198, hide: true },
        { id: 'lv', kind: 'label', x: 490, y: 150, t: 'читаем память по адресу nil…', cls: 'mut', hide: true },
        { id: 'mx', kind: 'mark', x: 560, y: 124, t: '✗', cls: 'bad', hide: true },
        { id: 'lp', kind: 'label', x: 490, y: 258, t: 'метод работает, o == nil', cls: 'ok', hide: true }
      ],
      steps: [
        { cap: 'В интерфейсе <code>d</code> лежит typed nil: тип <code>*Object</code>, данные nil. Вызываем <code>d.do()</code>.', set: {} },
        { cap: 'Тип записан — значит, itab есть, и метод находится. Но <code>do</code> объявлен со значимым ресивером: ему нужна копия <code>Object</code>, а не указатель.',
          set: { a1: { show: 1, cls: 'hot' }, fv: { cls: 'hot' } } },
        { cap: 'Чтобы сделать копию, рантайм должен прочитать <code>Object</code> по адресу из данных. А там nil.',
          set: { tok: { x: 490, y: 112 }, lv: { show: 1 } } },
        { cap: 'Чтение по адресу nil — паника <i>nil pointer dereference</i>. Именно это и спрашивает задача: интерфейс не nil, а вызов всё равно падает.',
          set: { fv: { cls: 'bad' }, mx: { show: 1 }, lv: { t: 'panic: nil pointer dereference', cls: 'bad' } } },
        { cap: 'Сравни с указательным ресивером. Копировать нечего: метод получает сам указатель, то есть nil. Пока внутри нет обращения к полям, всё работает.',
          set: { fp: { show: 1, cls: 'ok' }, a2: { show: 1, cls: 'ok' }, lp: { show: 1 } } }
      ]
    } },
    { p: 'Отсюда идиома nil-безопасных методов: метод с указательным ресивером сам проверяет ресивер на nil и не падает.' },
    { code: 'func (u *User) DisplayName() string {\n    if u == nil {\n        return "гость"\n    }\n    return u.Name\n}' },
    { warn: '<code>fmt.Println(err)</code> для typed nil печатает «&lt;nil&gt;», потому что fmt перехватывает панику. А явный вызов <code>err.Error()</code> на том же значении паникует — если метод читает поля. Не полагайся на то, что «в логе nil».', title: 'Осторожно' },

    { h: 'Как писать правильно' },
    { list: [
      '<b>Возвращай nil литералом.</b> В ветке «ошибки нет» пиши <code>return nil</code>, а не <code>return err</code>.',
      '<b>Не храни ошибку в переменной конкретного типа.</b> Если переменная нужна, объявляй её как <code>var err error</code>, а не <code>var err *NotFound</code>.',
      '<b>Осторожно с функциями, которые возвращают конкретный тип.</b> Если <code>func load() *NotFound</code>, то <code>var err error = load()</code> даст typed nil, когда load вернёт nil.',
      '<b>Доставай конкретную ошибку через {{errors-as}}</b>, а не через сравнение с nil: <code>var nf *NotFound; if errors.As(err, &nf) { … }</code>.'
    ] },
    { p: 'Та же ловушка возникает при передаче аргументом. Функция, которая принимает интерфейс, получает typed nil и честно считает его не-nil:' },
    { code: 'func isEmpty(v any) bool { return v == nil }\n\nvar d *Data\nfmt.Println(isEmpty(d)) // false', cap: 'Проверено на Go 1.26. Внутри функции v — это any с типом *Data и nil-данными.' },
    { code: 'func find(id int) error {\n    if id < 0 {\n        return &NotFound{ID: id}\n    }\n    return nil\n}', cap: 'Исправленная версия. В задании ниже ты сделаешь это сам.' },
    { warn: 'Проверка через <code>reflect.ValueOf(err).IsNil()</code> действительно скажет true для typed nil. Но это лечение симптома: если такая проверка понадобилась, значит, typed nil где-то уже создаётся, и чинить нужно там.', title: 'Не лечи симптомы' },

    { h: 'Сравнение интерфейсов между собой' },
    { p: 'Правило «и тип, и значение» работает не только для nil. Два интерфейса равны, если у них одинаковый динамический тип и равные значения:' },
    { code: 'var a, b any = 1, 1\nfmt.Println(a == b) // true\n\nvar c, d any = 1, int64(1)\nfmt.Println(c == d) // false: int и int64 — разные типы' },
    { p: 'А теперь опасное место. Интерфейс — {{comparable|сравнимый тип}}, поэтому компилятор разрешает <code>==</code> всегда. Но если внутри лежит несравнимое значение, например слайс, сравнение упадёт во время работы программы:' },
    { code: 'var p, q any = []int{1}, []int{1}\nfmt.Println(p == q)\n// panic: runtime error: comparing uncomparable type []int', cap: 'Дословный текст паники на Go 1.26.' },
    { p: 'Та же история с мапой, у которой ключ — интерфейс:' },
    { code: 'm := map[any]int{}\nm[[]int{1}] = 1\n// panic: runtime error: hash of unhashable type []int' },
    { note: 'Если динамические типы разные, до сравнения значений дело не доходит, и паники нет: <code>any([]int{1}) == any("строка")</code> спокойно вернёт false. Паника — только когда типы совпали и оказались несравнимыми.', title: 'Тонкость' }
  ],

  hands: {
    title: 'Найди и почини typed nil',
    goal: 'Увидеть typed nil в работе, исправить функцию так, чтобы она возвращала настоящий nil, и проверить, как сравниваются интерфейсы с разным содержимым.',
    steps: [
      { t: 'Запусти файл как есть', d: 'Из папки <code>study/practice</code>. До запуска посмотри на часть 2 в <code>i3/main.go</code> и сделай пять предсказаний.', cmd: 'go run ./i4',
        out: '— Часть 1 —\n❌ find(5) возвращает nil\n✅ find(-1) возвращает ошибку\n✅ errors.As достаёт *NotFound с ID -1\n\n— Часть 2: предскажи, потом запусти —\n1) true\n2) false\n3) false\n4) паника: runtime error: comparing uncomparable type []int\n5) d == nil: false\n5) паника: runtime error: invalid memory address or nil pointer dereference',
        after: 'Первая проверка красная: find(5) вернула typed nil. Сверь часть 2 со своими предсказаниями. Пятое — задача с собеса Napoleon IT, разбор — в уроке выше.' },
      { t: 'Почини find', d: 'Измени функцию <code>find</code> так, чтобы для неотрицательного id она возвращала настоящий nil. Сигнатуру не меняй.' },
      { t: 'Запусти снова', cmd: 'go run ./i4',
        out: '— Часть 1 —\n✅ find(5) возвращает nil\n✅ find(-1) возвращает ошибку\n✅ errors.As достаёт *NotFound с ID -1',
        after: 'Все три зелёные. Часть 2 не меняется — она только для предсказания.' }
    ],
    trouble: [
      'Правильных исправлений два: вернуть <code>nil</code> литералом в ветке без ошибки или объявить переменную как <code>var err error</code> вместо <code>var err *NotFound</code>. Подходит любое — оба убирают конкретный тип из возвращаемого интерфейса.',
      'Добавил в main проверку <code>if err != nil</code> с <code>reflect</code> — это лечение симптома. Чинить нужно саму find.',
      'Строки 3) и 4) удивили — перечитай раздел «Сравнение интерфейсов между собой»: паника только при совпавших несравнимых типах.'
    ],
    check: [
      { type: 'choice', q: 'Почему до исправления <code>find(5) == nil</code> было false?',
        opts: ['find(5) на самом деле создавала ошибку', 'Функция вернула интерфейс error с записанным типом *NotFound и nil-данными, а интерфейс равен nil, только если пусты и тип, и данные', 'Сравнение с nil в Go работает только для указателей', 'Из-за errors.As в следующей строке'],
        a: 1, why: 'Это typed nil. Тип <code>*NotFound</code> записан в первое слово интерфейса, поэтому интерфейс не nil.' },
      { type: 'choice', q: 'Почему строка 2) напечатала false, хотя оба значения равны единице?',
        opts: ['Интерфейсы нельзя сравнивать', 'Динамические типы разные — int и int64, а интерфейсы равны только при совпадении типа и значения', 'int64(1) хранится по-другому и не равен 1', 'Из-за упаковки значения лежат по разным адресам'],
        a: 1, why: 'Сравнение интерфейсов начинается с типов. Разные типы — сразу false, значения даже не сравниваются.' },
      { type: 'choice', q: 'Почему строка 3) напечатала false без паники, а строка 4) упала?',
        opts: ['В строке 3 слайс короче', 'В строке 3 типы разные ([]int и string), поэтому до сравнения значений не дошло. В строке 4 типы совпали, а слайсы несравнимы — паника', 'Строка 4 стоит внутри функции', 'Строки сравниваются, а слайсы нет — это всегда паника'],
        a: 1, why: 'Рантайм сначала сравнивает типы. Только если они совпали, он сравнивает значения — и для несравнимого типа паникует.' }
    ]
  },

  summary: [
    'Интерфейс равен nil, только если пусты и тип, и данные.',
    'Typed nil — интерфейс с записанным типом и nil-данными. Он не равен nil, хотя fmt может напечатать его как «<nil>».',
    'В ветке «ошибки нет» всегда пиши <code>return nil</code>. Не храни ошибку в переменной конкретного типа.',
    'Для конкретной ошибки используй errors.As с указателем на переменную.',
    'Интерфейсы равны, если совпадают динамический тип и значение. int и int64 с одинаковым числом — не равны.',
    'Сравнение интерфейсов, в которых лежат слайсы, мапы или функции одного типа, паникует в рантайме. То же для ключей map[any].',
    'Метод у nil-интерфейса — паника. У typed nil с указательным ресивером метод вызывается с ресивером nil. Со значимым ресивером — паника.'
  ],

  test: [
    { type: 'choice', q: 'Когда значение интерфейсного типа равно nil?',
      opts: ['Когда данные внутри равны nil', 'Когда и тип, и данные пусты', 'Когда тип равен nil', 'Когда в нём лежит nil-указатель любого типа'],
      a: 1, why: 'Нужны обе половины. Если тип записан, интерфейс не nil, даже если данные — nil.' },
    { type: 'choice', q: 'Что напечатает этот код?<pre><code>var p *bytes.Buffer\nvar w io.Writer = p\nfmt.Println(w == nil)</code></pre>',
      opts: ['true', 'false', 'Ошибка компиляции', 'Паника'],
      a: 1, why: 'В w записан тип *bytes.Buffer и nil-данные — typed nil. Интерфейс не равен nil.' },
    { type: 'choice', q: 'Функция <code>func check() error</code> возвращает typed nil. Что увидит <code>fmt.Println(check())</code>, если метод Error() читает поле структуры?',
      opts: ['Панику nil pointer dereference', '<nil> — fmt перехватывает панику у nil-указателя и печатает <nil>', 'Пустую строку', 'Текст ошибки с нулевыми полями'],
      a: 1, why: 'fmt специально обрабатывает панику в Error() и String() у nil-указателей и печатает «<nil>». Поэтому в логах typed nil выглядит как настоящий nil — и это делает баг коварным.' },
    { type: 'choice', q: 'Какой вариант функции правильный?',
      opts: ['var err *MyErr; if bad { err = &MyErr{} }; return err', 'if bad { return &MyErr{} }; return nil', 'var err *MyErr; return err', 'return (*MyErr)(nil)'],
      a: 1, why: 'Только во втором варианте в ветке «ошибки нет» возвращается nil-интерфейс. В остальных возвращается typed nil.' },
    { type: 'text', q: 'Как называется интерфейс, в котором записан тип, а данные — nil-указатель? Два слова, латиницей.',
      a: ['typed nil'], why: 'Typed nil. На русском иногда говорят «типизированный nil».' },
    { type: 'choice', q: 'Что вернёт <code>any(1) == any(int64(1))</code>?',
      opts: ['true', 'false', 'Ошибка компиляции', 'Паника'],
      a: 1, why: 'Типы int и int64 разные, поэтому интерфейсы не равны. До сравнения чисел дело не доходит.' },
    { type: 'choice', q: 'Что произойдёт?<pre><code>var a, b any = []int{1}, []int{1}\nfmt.Println(a == b)</code></pre>',
      opts: ['true', 'false', 'Ошибка компиляции', 'Паника: comparing uncomparable type []int'],
      a: 3, why: 'Компилятор разрешает == для интерфейсов. Но в рантайме выясняется, что типы совпали и они несравнимы, — паника.' },
    { type: 'choice', q: 'Как правильно проверить, что ошибка — это *NotFound, и достать её поля?',
      opts: ['if err.(*NotFound) != nil', 'var nf *NotFound; if errors.As(err, &nf) { … }', 'if reflect.TypeOf(err) == reflect.TypeOf(&NotFound{})', 'if err == &NotFound{}'],
      a: 1, why: 'errors.As проходит по всей цепочке обёрток и записывает найденную ошибку в nf. Вторым аргументом — указатель на переменную.' },
    { type: 'order', q: 'Расставь в правильном порядке, что происходит, когда <code>find(5)</code> из урока возвращает typed nil.',
      items: ['var err *NotFound — переменная получает нулевое значение nil', 'Ветка if не выполняется', 'return err упаковывает nil-указатель в error вместе с типом *NotFound', 'Снаружи err != nil даёт true, потому что тип в интерфейсе записан'],
      why: 'Ловушка возникает в момент return: конкретный тип неявно превращается в интерфейс вместе со своим типом.' },
    { type: 'choice', q: 'Что произойдёт?<pre><code>type Doer interface{ do() }\ntype Object struct{ name string }\nfunc (o Object) do() {}\n\nvar o *Object\nvar d Doer = o\nd.do()</code></pre>',
      opts: ['Ничего: метод вызовется с пустым Object', 'Паника: nil pointer dereference — для значимого ресивера нужно разыменовать nil', 'Ошибка компиляции', 'Паника: метод не найден, потому что d == nil'],
      a: 1, why: 'd не nil — тип записан, метод находится. Но ресивер значимый: рантайм должен скопировать Object по адресу nil, и это паника. С ресивером *Object вызов прошёл бы.' },
    { type: 'choice', q: 'Что напечатает <code>isEmpty(d)</code>, если <code>func isEmpty(v any) bool { return v == nil }</code>, а <code>d</code> — nil-указатель <code>*Data</code>?',
      opts: ['true', 'false', 'Ошибка компиляции', 'Паника'],
      a: 1, why: 'При передаче в параметр any указатель упаковывается вместе с типом *Data. Получается typed nil, и он не равен nil.' }
  ]
};
