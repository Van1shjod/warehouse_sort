"""
Creates EN, PL, RU copies of presentation.pptx by replacing Ukrainian text runs.
Preserves all formatting, images, layout. Only text content changes.
"""
import zipfile, shutil, os, re
import xml.etree.ElementTree as ET

SRC = "presentation.pptx"
LANGS = {
    "en": "presentation-en.pptx",
    "pl": "presentation-pl.pptx",
    "ru": "presentation-ru.pptx",
}

# ---------------------------------------------------------------------------
# Translation tables
# Keys = exact Ukrainian strings found in slides/notes (stripped).
# Values = dict lang -> translation.
# Technical terms kept in English/original: Warehouse System, Sort, Pre-sort,
# Single, Mix, Vevor, OCR, PACK, ICC, Admin, «Адмін» button label translated.
# ---------------------------------------------------------------------------

SLIDE_TRANS = {
    # S1
    "Система сортування": {
        "en": "Sorting and inventory",
        "pl": "System sortowania",
        "ru": "Система сортировки",
    },
    "та обліку картонів.": {
        "en": "system for cartons.",
        "pl": "i ewidencji kartonów.",
        "ru": "и учёта картонов.",
    },
    "Pre-sort та Sort": {
        "en": "Pre-sort and Sort",
        "pl": "Pre-sort i Sort",
        "ru": "Pre-sort и Sort",
    },
    # S2
    "Від Pre-sort до Sort": {
        "en": "From Pre-sort to Sort",
        "pl": "Od Pre-sort do Sort",
        "ru": "От Pre-sort к Sort",
    },
    "Після розвантаження адміністратор закриває Pre-sort": {
        "en": "After unloading, the admin closes Pre-sort",
        "pl": "Po rozładunku administrator zamyka Pre-sort",
        "ru": "После разгрузки администратор закрывает Pre-sort",
    },
    "і підтверджує «Перевести в SORT».": {
        "en": "and confirms \"Convert to SORT\".",
        "pl": "i potwierdza \"Przenieś do SORT\".",
        "ru": "и подтверждает «Перевести в SORT».",
    },
    "Що зберігається": {
        "en": "What is preserved",
        "pl": "Co jest zachowywane",
        "ru": "Что сохраняется",
    },
    "Дані наклейок, початкові": {
        "en": "Label data, initial",
        "pl": "Dane etykiet, pierwotne",
        "ru": "Данные наклеек, исходные",
    },
    "палети та історія додавань.": {
        "en": "pallets and addition history.",
        "pl": "palety i historia dodawań.",
        "ru": "паллеты и история добавлений.",
    },
    "Для чого": {
        "en": "Purpose",
        "pl": "Po co",
        "ru": "Зачем",
    },
    "Sort знає, на яких палетах": {
        "en": "Sort knows which pallets",
        "pl": "Sort wie, na których paletach",
        "ru": "Sort знает, на каких паллетах",
    },
    "шукати однакові картони.": {
        "en": "to look for matching cartons.",
        "pl": "szukać tych samych kartonów.",
        "ru": "искать одинаковые картоны.",
    },
    "Повторно вводити дані Pre-sort не потрібно.": {
        "en": "No need to re-enter Pre-sort data.",
        "pl": "Nie trzeba ponownie wprowadzać danych Pre-sort.",
        "ru": "Повторно вводить данные Pre-sort не нужно.",
    },
    # S3
    "Sort. Два режими роботи.": {
        "en": "Sort. Two working modes.",
        "pl": "Sort. Dwa tryby pracy.",
        "ru": "Sort. Два режима работы.",
    },
    "Один товар": {
        "en": "One item",
        "pl": "Jeden towar",
        "ru": "Один товар",
    },
    "Збираємо однакові картони": {
        "en": "Collect identical cartons",
        "pl": "Zbieramy jednakowe kartony",
        "ru": "Собираем одинаковые картоны",
    },
    "з палет-джерел Pre-sort.": {
        "en": "from Pre-sort source pallets.",
        "pl": "z palet-źródeł Pre-sort.",
        "ru": "с паллет-источников Pre-sort.",
    },
    "Різні товари": {
        "en": "Mixed items",
        "pl": "Różne towary",
        "ru": "Разные товары",
    },
    "Вказуємо кількість у руках": {
        "en": "We specify the quantity in hand",
        "pl": "Podajemy ilość w rękach",
        "ru": "Указываем количество в руках",
    },
    "та палету SORT.": {
        "en": "and the SORT pallet.",
        "pl": "i paletę SORT.",
        "ru": "и паллет SORT.",
    },
    "Single та Mix": {
        "en": "Single and Mix",
        "pl": "Single i Mix",
        "ru": "Single и Mix",
    },
    "Vevor — у розробці": {
        "en": "Vevor — in development",
        "pl": "Vevor — w budowie",
        "ru": "Vevor — в разработке",
    },
    "Оберіть завдання, потім Single або Mix і спосіб роботи.": {
        "en": "Select a task, then Single or Mix and the working mode.",
        "pl": "Wybierz zadanie, potem Single lub Mix i tryb pracy.",
        "ru": "Выберите задание, затем Single или Mix и режим работы.",
    },
    # S4
    "Наклейка → кількість у руках → палета SORT.": {
        "en": "Label → quantity in hand → SORT pallet.",
        "pl": "Etykieta → ilość w rękach → paleta SORT.",
        "ru": "Наклейка → количество в руках → паллет SORT.",
    },
    "PACK не дорівнює кількості картонів у руках.": {
        "en": "PACK does not equal the number of cartons in hand.",
        "pl": "PACK nie równa się liczbie kartonów w rękach.",
        "ru": "PACK не равен количеству картонов в руках.",
    },
    # S5
    "Система показує,": {
        "en": "The system shows",
        "pl": "System pokazuje,",
        "ru": "Система показывает,",
    },
    "куди підійти далі.": {
        "en": "where to go next.",
        "pl": "gdzie iść dalej.",
        "ru": "куда подойти дальше.",
    },
    "Підтверджуємо палету й кожен картон.": {
        "en": "Confirm the pallet and each carton.",
        "pl": "Potwierdzamy paletę i każdy karton.",
        "ru": "Подтверждаем паллет и каждый картон.",
    },
    "Один збіг наклейки означає один картон.": {
        "en": "One label match means one carton.",
        "pl": "Jedno dopasowanie etykiety oznacza jeden karton.",
        "ru": "Одно совпадение наклейки означает один картон.",
    },
    "Порядок обходу можна змінити.": {
        "en": "The traversal order can be changed.",
        "pl": "Kolejność przejścia można zmienić.",
        "ru": "Порядок обхода можно изменить.",
    },
    # S6
    "Завершення роботи": {
        "en": "End of work",
        "pl": "Zakończenie pracy",
        "ru": "Завершение работы",
    },
    "Працівник": {
        "en": "Worker",
        "pl": "Pracownik",
        "ru": "Работник",
    },
    "«Завершити» виходить із робочого сценарію.": {
        "en": "\"Finish\" exits the working scenario.",
        "pl": "\"Zakończ\" wychodzi z scenariusza pracy.",
        "ru": "«Завершить» выходит из рабочего сценария.",
    },
    "Усі підтверджені картони зберігаються.": {
        "en": "All confirmed cartons are saved.",
        "pl": "Wszystkie potwierdzone kartony są zapisane.",
        "ru": "Все подтверждённые картоны сохраняются.",
    },
    "Адміністратор": {
        "en": "Administrator",
        "pl": "Administrator",
        "ru": "Администратор",
    },
    "Закриває все завдання, коли роботу виконано.": {
        "en": "Closes the entire task when the work is done.",
        "pl": "Zamyka całe zadanie po zakończeniu pracy.",
        "ru": "Закрывает всё задание, когда работа выполнена.",
    },
    "Дані та історія залишаються доступними.": {
        "en": "Data and history remain accessible.",
        "pl": "Dane i historia pozostają dostępne.",
        "ru": "Данные и история остаются доступными.",
    },
    # S7
    "Збережені дані Pre-sort": {
        "en": "Saved Pre-sort data",
        "pl": "Zapisane dane Pre-sort",
        "ru": "Сохранённые данные Pre-sort",
    },
    "Admin: список товарів або журнал кожного додавання.": {
        "en": "Admin: item list or log of every addition.",
        "pl": "Admin: lista towarów lub dziennik każdego dodania.",
        "ru": "Admin: список товаров или журнал каждого добавления.",
    },
    "Товар": {
        "en": "Item",
        "pl": "Towar",
        "ru": "Товар",
    },
    "Тип": {
        "en": "Type",
        "pl": "Typ",
        "ru": "Тип",
    },
    "Додано / PACK": {
        "en": "Added / PACK",
        "pl": "Dodano / PACK",
        "ru": "Добавлено / PACK",
    },
    "Палет": {
        "en": "Pallets",
        "pl": "Palet",
        "ru": "Паллет",
    },
    "Розміщення": {
        "en": "Location",
        "pl": "Rozmieszczenie",
        "ru": "Размещение",
    },
    "№1: 6 шт.": {
        "en": "#1: 6 pcs.",
        "pl": "#1: 6 szt.",
        "ru": "№1: 6 шт.",
    },
    "№4: 4 шт.": {
        "en": "#4: 4 pcs.",
        "pl": "#4: 4 szt.",
        "ru": "№4: 4 шт.",
    },
    "№10: 3 шт.": {
        "en": "#10: 3 pcs.",
        "pl": "#10: 3 szt.",
        "ru": "№10: 3 шт.",
    },
    "Код, PACK, кількість і палети; пошук та фільтри.": {
        "en": "Code, PACK, quantity and pallets; search and filters.",
        "pl": "Kod, PACK, ilość i palety; wyszukiwanie i filtry.",
        "ru": "Код, PACK, количество и паллеты; поиск и фильтры.",
    },
    "Це підсумок розвантаження. Поточний стан дивимось": {
        "en": "This is the unloading summary. Current state is in",
        "pl": "To podsumowanie rozładunku. Aktualny stan w",
        "ru": "Это итог разгрузки. Текущее состояние смотрим",
    },
    "у розділі «Рухи та залишки».": {
        "en": "the \"Movements and balances\" section.",
        "pl": "sekcji \"Ruchy i stany\".",
        "ru": "в разделе «Движения и остатки».",
    },
    # S8
    "Поточні рухи та залишки": {
        "en": "Current movements and balances",
        "pl": "Aktualne ruchy i stany",
        "ru": "Текущие движения и остатки",
    },
    "Що зараз на палетах і що вже зібрав кожен працівник.": {
        "en": "What is on the pallets now and what each worker has already collected.",
        "pl": "Co jest teraz na paletach i co zebrał każdy pracownik.",
        "ru": "Что сейчас на паллетах и что уже собрал каждый работник.",
    },
    "Пошук за товаром, палетою або працівником.": {
        "en": "Search by item, pallet or worker.",
        "pl": "Wyszukiwanie po towarze, palecie lub pracowniku.",
        "ru": "Поиск по товару, паллету или работнику.",
    },
    # S9
    "Керування завданнями й командою": {
        "en": "Task and team management",
        "pl": "Zarządzanie zadaniami i zespołem",
        "ru": "Управление заданиями и командой",
    },
    "Завдання": {
        "en": "Tasks",
        "pl": "Zadania",
        "ru": "Задания",
    },
    "Статуси, прогрес і палети SORT.": {
        "en": "Statuses, progress and SORT pallets.",
        "pl": "Statusy, postęp i palety SORT.",
        "ru": "Статусы, прогресс и паллеты SORT.",
    },
    "Закриття та переведення Pre-sort.": {
        "en": "Closing and converting Pre-sort.",
        "pl": "Zamknięcie i przeniesienie Pre-sort.",
        "ru": "Закрытие и перевод Pre-sort.",
    },
    "Видалення після підтвердження «Так / Ні».": {
        "en": "Delete after \"Yes / No\" confirmation.",
        "pl": "Usunięcie po potwierdzeniu \"Tak / Nie\".",
        "ru": "Удаление после подтверждения «Да / Нет».",
    },
    "Користувачі": {
        "en": "Users",
        "pl": "Użytkownicy",
        "ru": "Пользователи",
    },
    "Створення акаунтів, ролі, онлайн-статус": {
        "en": "Account creation, roles, online status",
        "pl": "Tworzenie kont, role, status online",
        "ru": "Создание аккаунтов, роли, онлайн-статус",
    },
    "і кількість опрацьованих картонів.": {
        "en": "and number of processed cartons.",
        "pl": "i liczba przetworzonych kartonów.",
        "ru": "и количество обработанных картонов.",
    },
    # S10
    "Коригування та захист даних": {
        "en": "Adjustments and data protection",
        "pl": "Korekty i ochrona danych",
        "ru": "Корректировки и защита данных",
    },
    "Контроль адміністратора": {
        "en": "Administrator control",
        "pl": "Kontrola administratora",
        "ru": "Контроль администратора",
    },
    "Очікувана кількість товару.": {
        "en": "Expected item quantity.",
        "pl": "Oczekiwana ilość towaru.",
        "ru": "Ожидаемое количество товара.",
    },
    "Номер і стан звичайної палети.": {
        "en": "Number and status of a regular pallet.",
        "pl": "Numer i stan zwykłej palety.",
        "ru": "Номер и состояние обычного паллета.",
    },
    "Додавання або списання з причиною.": {
        "en": "Addition or write-off with reason.",
        "pl": "Dodanie lub odpisanie z powodem.",
        "ru": "Добавление или списание с причиной.",
    },
    "Збереження історії": {
        "en": "History preservation",
        "pl": "Zachowanie historii",
        "ru": "Сохранение истории",
    },
    "Undo створює зворотний рух.": {
        "en": "Undo creates a reverse movement.",
        "pl": "Undo tworzy ruch odwrotny.",
        "ru": "Undo создаёт обратное движение.",
    },
    "Повтор запиту не дублює картон.": {
        "en": "Retrying the request does not duplicate a carton.",
        "pl": "Ponowienie żądania nie duplikuje kartonu.",
        "ru": "Повтор запроса не дублирует картон.",
    },
    "Відбір перевіряє доступний залишок.": {
        "en": "Picking checks the available balance.",
        "pl": "Pobieranie sprawdza dostępny stan.",
        "ru": "Отбор проверяет доступный остаток.",
    },
    "Для керованого відбору є налаштування перевірки формату ICC.": {
        "en": "Managed picking has an ICC format validation setting.",
        "pl": "Zarządzane pobieranie ma ustawienie weryfikacji formatu ICC.",
        "ru": "Для управляемого отбора есть настройка проверки формата ICC.",
    },
    # S11
    "Журнали дій та OCR": {
        "en": "Action logs and OCR",
        "pl": "Dzienniki działań i OCR",
        "ru": "Журналы действий и OCR",
    },
    "Активність": {
        "en": "Activity",
        "pl": "Aktywność",
        "ru": "Активность",
    },
    "OCR Логи": {
        "en": "OCR Logs",
        "pl": "Logi OCR",
        "ru": "OCR Логи",
    },
    "Фото, розпізнані дані, результат і ручні виправлення.": {
        "en": "Photo, recognised data, result and manual corrections.",
        "pl": "Zdjęcie, rozpoznane dane, wynik i ręczne poprawki.",
        "ru": "Фото, распознанные данные, результат и ручные исправления.",
    },
    "Фільтри за типом наклейки, успіхом і датою.": {
        "en": "Filters by label type, success and date.",
        "pl": "Filtry według typu etykiety, sukcesu i daty.",
        "ru": "Фильтры по типу наклейки, успеху и дате.",
    },
    # S12
    "Ідея системи": {
        "en": "System concept",
        "pl": "Idea systemu",
        "ru": "Идея системы",
    },
    "Знати, де лежить потрібний картон,": {
        "en": "Know where the needed carton is",
        "pl": "Wiedzieć, gdzie leży potrzebny karton,",
        "ru": "Знать, где лежит нужный картон,",
    },
    "і використовувати ці дані під час сортування.": {
        "en": "and use that data during sorting.",
        "pl": "i używać tych danych podczas sortowania.",
        "ru": "и использовать эти данные при сортировке.",
    },
    "Під час розвантаження": {
        "en": "During unloading",
        "pl": "Podczas rozładunku",
        "ru": "Во время разгрузки",
    },
    "фіксуємо кожен картон": {
        "en": "we record each carton",
        "pl": "rejestrujemy każdy karton",
        "ru": "фиксируем каждый картон",
    },
    "на пронумерованій палеті.": {
        "en": "on a numbered pallet.",
        "pl": "na ponumerowanej palecie.",
        "ru": "на пронумерованном паллете.",
    },
    "Сортуємо різні товари": {
        "en": "Sort different items",
        "pl": "Sortujemy różne towary",
        "ru": "Сортируем разные товары",
    },
    "або збираємо однакові": {
        "en": "or collect identical ones",
        "pl": "lub zbieramy jednakowe",
        "ru": "или собираем одинаковые",
    },
    "зі збережених локацій.": {
        "en": "from saved locations.",
        "pl": "z zapisanych lokalizacji.",
        "ru": "из сохранённых локаций.",
    },
    # S13
    "Дякую": {
        "en": "Thank you",
        "pl": "Dziękujemy",
        "ru": "Спасибо",
    },
    "за увагу!": {
        "en": "for your attention!",
        "pl": "za uwagę!",
        "ru": "за внимание!",
    },
    "Запитання та обговорення.": {
        "en": "Questions and discussion.",
        "pl": "Pytania i dyskusja.",
        "ru": "Вопросы и обсуждение.",
    },
    # S14
    "Вхід і реєстрація": {
        "en": "Login and registration",
        "pl": "Logowanie i rejestracja",
        "ru": "Вход и регистрация",
    },
    "Новий користувач": {
        "en": "New user",
        "pl": "Nowy użytkownik",
        "ru": "Новый пользователь",
    },
    "Оберіть «Реєстрація», введіть логін,": {
        "en": "Select \"Register\", enter login,",
        "pl": "Wybierz \"Rejestracja\", wpisz login,",
        "ru": "Выберите «Реєстрація», введите логин,",
    },
    "пароль і його підтвердження. Потім увійдіть.": {
        "en": "password and its confirmation. Then log in.",
        "pl": "hasło i jego potwierdzenie. Następnie zaloguj się.",
        "ru": "пароль и его подтверждение. Затем войдите.",
    },
    "Акаунт уже є": {
        "en": "Already have an account",
        "pl": "Mam już konto",
        "ru": "Аккаунт уже есть",
    },
    "Введіть логін і пароль на вкладці «Вхід».": {
        "en": "Enter login and password on the \"Login\" tab.",
        "pl": "Wpisz login i hasło na karcie \"Logowanie\".",
        "ru": "Введите логин и пароль на вкладке «Вхід».",
    },
    # S15
    "Головне меню та ролі": {
        "en": "Main menu and roles",
        "pl": "Menu główne i role",
        "ru": "Главное меню и роли",
    },
    "Відкриває Sort або Pre-sort,": {
        "en": "Opens Sort or Pre-sort,",
        "pl": "Otwiera Sort lub Pre-sort,",
        "ru": "Открывает Sort или Pre-sort,",
    },
    "обирає завдання й працює з картонами.": {
        "en": "selects a task and works with cartons.",
        "pl": "wybiera zadanie i pracuje z kartonami.",
        "ru": "выбирает задание и работает с картонами.",
    },
    "Створює завдання та керує даними": {
        "en": "Creates tasks and manages data",
        "pl": "Tworzy zadania i zarządza danymi",
        "ru": "Создаёт задания и управляет данными",
    },
    "через кнопку «Адмін».": {
        "en": "via the \"Admin\" button.",
        "pl": "przez przycisk \"Admin\".",
        "ru": "через кнопку «Адмін».",
    },
    # S16
    "Навіщо створювати завдання": {
        "en": "Why create tasks",
        "pl": "Po co tworzyć zadania",
        "ru": "Зачем создавать задания",
    },
    "Кожне завдання має власні дані": {
        "en": "Each task has its own data",
        "pl": "Każde zadanie ma własne dane",
        "ru": "Каждое задание имеет собственные данные",
    },
    "Локація, дата, типи картонів і статус": {
        "en": "Location, date, carton types and status",
        "pl": "Lokalizacja, data, typy kartonów i status",
        "ru": "Локация, дата, типы картонов и статус",
    },
    "об'єднують роботу в одному завданні.": {
        "en": "unite the work in one task.",
        "pl": "łączą pracę w jednym zadaniu.",
        "ru": "объединяют работу в одном задании.",
    },
    "До нього прив'язані товари, палети, працівники та рухи.": {
        "en": "Items, pallets, workers and movements are linked to it.",
        "pl": "Powiązane są z nim towary, palety, pracownicy i ruchy.",
        "ru": "К нему привязаны товары, паллеты, работники и движения.",
    },
    "Пізніше можна відкрити потрібний сорт, перевірити": {
        "en": "Later you can open the needed sort, check",
        "pl": "Później można otworzyć potrzebne sortowanie, sprawdzić",
        "ru": "Позже можно открыть нужный сорт, проверить",
    },
    "його результат і продовжити роботу зі збереженими даними.": {
        "en": "its result and continue working with the saved data.",
        "pl": "jego wynik i kontynuować pracę z zapisanymi danymi.",
        "ru": "его результат и продолжить работу с сохранёнными данными.",
    },
    # S17
    "Створення Sort або Pre-sort": {
        "en": "Creating Sort or Pre-sort",
        "pl": "Tworzenie Sort lub Pre-sort",
        "ru": "Создание Sort или Pre-sort",
    },
    "Admin: «Sort: товари й завдання», далі «Завдання та створення».": {
        "en": "Admin: \"Sort: items and tasks\", then \"Tasks and creation\".",
        "pl": "Admin: \"Sort: towary i zadania\", dalej \"Zadania i tworzenie\".",
        "ru": "Admin: «Sort: товары и задания», далее «Задания и создание».",
    },
    "1. Режим і локація": {
        "en": "1. Mode and location",
        "pl": "1. Tryb i lokalizacja",
        "ru": "1. Режим и локация",
    },
    "Оберіть SORT / PRE-SORT,": {
        "en": "Select SORT / PRE-SORT,",
        "pl": "Wybierz SORT / PRE-SORT,",
        "ru": "Выберите SORT / PRE-SORT,",
    },
    "зону або рампу та її номер.": {
        "en": "zone or ramp and its number.",
        "pl": "strefę lub rampę i jej numer.",
        "ru": "зону или рампу и её номер.",
    },
    "2. Типи картонів": {
        "en": "2. Carton types",
        "pl": "2. Typy kartonów",
        "ru": "2. Типы картонов",
    },
    "Single та/або Mix.": {
        "en": "Single and/or Mix.",
        "pl": "Single i/lub Mix.",
        "ru": "Single и/или Mix.",
    },
    "Дата й примітки необов'язкові.": {
        "en": "Date and notes are optional.",
        "pl": "Data i notatki są opcjonalne.",
        "ru": "Дата и примечания необязательны.",
    },
    "3. Натисніть «Створити»": {
        "en": "3. Click \"Create\"",
        "pl": "3. Kliknij \"Utwórz\"",
        "ru": "3. Нажмите «Створити»",
    },
    # S18
    "Введення даних картона": {
        "en": "Entering carton data",
        "pl": "Wprowadzanie danych kartonu",
        "ru": "Ввод данных картона",
    },
    "Через OCR": {
        "en": "Via OCR",
        "pl": "Przez OCR",
        "ru": "Через OCR",
    },
    "«Сканувати», наклейка в рамці, фото.": {
        "en": "\"Scan\", label in frame, photo.",
        "pl": "\"Skanuj\", etykieta w ramce, zdjęcie.",
        "ru": "«Сканувати», наклейка в рамке, фото.",
    },
    "Повний коректний результат": {
        "en": "A complete correct result",
        "pl": "Pełny poprawny wynik",
        "ru": "Полный корректный результат",
    },
    "підтверджується автоматично.": {
        "en": "is confirmed automatically.",
        "pl": "jest potwierdzany automatycznie.",
        "ru": "подтверждается автоматически.",
    },
    "Вручну": {
        "en": "Manually",
        "pl": "Ręcznie",
        "ru": "Вручную",
    },
    "Single: ICC, PACK і кодові букви.": {
        "en": "Single: ICC, PACK and code letters.",
        "pl": "Single: ICC, PACK i litery kodu.",
        "ru": "Single: ICC, PACK и кодовые буквы.",
    },
    "Mix: код наклейки. Далі «Продовжити».": {
        "en": "Mix: label code. Then \"Continue\".",
        "pl": "Mix: kod etykiety. Następnie \"Kontynuuj\".",
        "ru": "Mix: код наклейки. Далее «Продовжити».",
    },
    # S19
    "OCR: сканування наклейки": {
        "en": "OCR: label scanning",
        "pl": "OCR: skanowanie etykiety",
        "ru": "OCR: сканирование наклейки",
    },
    "1. Відкрийте камеру": {
        "en": "1. Open the camera",
        "pl": "1. Otwórz kamerę",
        "ru": "1. Откройте камеру",
    },
    "Натисніть «Сканувати» й дозвольте доступ.": {
        "en": "Press \"Scan\" and allow access.",
        "pl": "Naciśnij \"Skanuj\" i zezwól na dostęp.",
        "ru": "Нажмите «Сканувати» и разрешите доступ.",
    },
    "2. Розташуйте наклейку в рамці": {
        "en": "2. Place the label in the frame",
        "pl": "2. Umieść etykietę w ramce",
        "ru": "2. Разместите наклейку в рамке",
    },
    "Код, PACK і букви мають бути чітко видимими.": {
        "en": "Code, PACK and letters must be clearly visible.",
        "pl": "Kod, PACK i litery muszą być wyraźnie widoczne.",
        "ru": "Код, PACK и буквы должны быть чётко видны.",
    },
    "3. Натисніть «Зробити фото»": {
        "en": "3. Press \"Take photo\"",
        "pl": "3. Naciśnij \"Zrób zdjęcie\"",
        "ru": "3. Нажмите «Зробити фото»",
    },
    "Сайт розпізнає дані й продовжить роботу.": {
        "en": "The site recognises the data and continues.",
        "pl": "Strona rozpoznaje dane i kontynuuje.",
        "ru": "Сайт распознаёт данные и продолжает работу.",
    },
    "Неповний результат можна доповнити вручну.": {
        "en": "An incomplete result can be completed manually.",
        "pl": "Niekompletny wynik można uzupełnić ręcznie.",
        "ru": "Неполный результат можно дополнить вручную.",
    },
    # S20
    "Пронумерована палета.": {
        "en": "Numbered pallet.",
        "pl": "Ponumerowana paleta.",
        "ru": "Пронумерованный паллет.",
    },
    "Кожен картон — у списку.": {
        "en": "Each carton — in the list.",
        "pl": "Każdy karton — na liście.",
        "ru": "Каждый картон — в списке.",
    },
    "Скануйте наклейку.": {
        "en": "Scan the label.",
        "pl": "Skanuj etykietę.",
        "ru": "Сканируйте наклейку.",
    },
    "Додавайте по одному.": {
        "en": "Add one at a time.",
        "pl": "Dodawaj po jednym.",
        "ru": "Добавляйте по одному.",
    },
    "Закривайте повну палету.": {
        "en": "Close the full pallet.",
        "pl": "Zamykaj pełną paletę.",
        "ru": "Закрывайте полный паллет.",
    },
}

# Notes translation (full paragraph replacement)
NOTES_TRANS = {
    # paragraph text -> {lang: translation}
    "Warehouse System організовує роботу з картонами: під час розвантаження зберігає їх розміщення, а далі допомагає сортувати й збирати потрібні товари. Презентація проходить шлях користувача від входу до результатів роботи та адміністрування.": {
        "en": "Warehouse System organises carton work: during unloading it records their placement, then helps sort and collect needed items. The presentation follows the user journey from login to work results and administration.",
        "pl": "Warehouse System organizuje pracę z kartonami: podczas rozładunku zapisuje ich rozmieszczenie, a następnie pomaga sortować i zbierać potrzebne towary. Prezentacja pokazuje ścieżkę użytkownika od logowania do wyników pracy i administracji.",
        "ru": "Warehouse System организует работу с картонами: во время разгрузки сохраняет их расположение, а затем помогает сортировать и собирать нужные товары. Презентация проходит путь пользователя от входа до результатов работы и администрирования.",
    },
    "Джерело: чинний код Warehouse System, шаблони та активні клієнтські сценарії. Скриншоти справжнього інтерфейсу отримано на окремій тимчасовій базі; облікові коди й кількості є демонстраційними прикладами.": {
        "en": "Source: current Warehouse System code, templates and active client scenarios. Screenshots of the real interface were taken on a separate temporary database; account codes and quantities are demonstration examples.",
        "pl": "Źródło: aktualny kod Warehouse System, szablony i aktywne scenariusze klienta. Zrzuty ekranu prawdziwego interfejsu wykonano na oddzielnej tymczasowej bazie danych; kody i ilości są przykładami demonstracyjnymi.",
        "ru": "Источник: действующий код Warehouse System, шаблоны и активные клиентские сценарии. Скриншоты реального интерфейса получены на отдельной временной базе; учётные коды и количества являются демонстрационными примерами.",
    },
    "Адмін спочатку закриває все завдання Pre-sort, а потім переводить його в Sort із підтвердженням. Залишається той самий ID завдання, дані наклейок, початкові номери й вміст палет. Завдання знову активне як Sort. На основі цих джерельних даних працює Один товар. Початковий архів залишається доступним в Admin навіть після конвертації.": {
        "en": "The admin first closes the entire Pre-sort task, then converts it to Sort with confirmation. The same task ID, label data, initial pallet numbers and contents remain. The task becomes active again as Sort. One item mode works based on these source data. The initial archive remains accessible in Admin even after conversion.",
        "pl": "Administrator najpierw zamyka całe zadanie Pre-sort, a następnie przenosi je do Sort z potwierdzeniem. Pozostaje ten sam ID zadania, dane etykiet, pierwotne numery i zawartość palet. Zadanie jest znowu aktywne jako Sort. Na podstawie tych danych źródłowych działa tryb Jeden towar. Pierwotne archiwum pozostaje dostępne w Admin nawet po konwersji.",
        "ru": "Сначала администратор закрывает всё задание Pre-sort, затем переводит его в Sort с подтверждением. Остаётся тот же ID задания, данные наклеек, исходные номера и содержимое паллетов. Задание снова активно как Sort. На основе этих исходных данных работает режим Один товар. Исходный архив остаётся доступным в Admin даже после конвертации.",
    },
    "Працівник відкриває SORT, обирає активне завдання за локацією та датою, дозволений Single або Mix, потім Один товар чи Різні товари. Список показує прогрес і наявність даних Pre-sort. Один товар доступний для завдання, переведеного з Pre-sort; звичайний режим Різні товари працює і без Pre-sort. Vevor поки у розробці. Змінити завдання можна без втрати вже підтверджених картонів.": {
        "en": "The worker opens SORT, selects an active task by location and date, allowed Single or Mix, then One item or Mixed items. The list shows progress and available Pre-sort data. One item is available for tasks converted from Pre-sort; regular Mixed items mode works without Pre-sort too. Vevor is still in development. The task can be changed without losing already confirmed cartons.",
        "pl": "Pracownik otwiera SORT, wybiera aktywne zadanie według lokalizacji i daty, dozwolone Single lub Mix, a następnie Jeden towar lub Różne towary. Lista pokazuje postęp i dostępność danych Pre-sort. Jeden towar jest dostępny dla zadania przeniesionego z Pre-sort; zwykły tryb Różne towary działa również bez Pre-sort. Vevor jest jeszcze w budowie. Zadanie można zmienić bez utraty już potwierdzonych kartonów.",
        "ru": "Работник открывает SORT, выбирает активное задание по локации и дате, разрешённые Single или Mix, затем Один товар или Разные товары. Список показывает прогресс и наличие данных Pre-sort. Один товар доступен для задания, переведённого из Pre-sort; обычный режим Разные товары работает и без Pre-sort. Vevor пока в разработке. Задание можно изменить без потери уже подтверждённых картонов.",
    },
    "У Різні товари наклейку вводять OCR або вручну. Далі працівник указує фактичну кількість картонів у руках, потім номер кінцевої палети SORT і підтверджує. PACK не використовується як автоматична додана кількість. Є прогрес збирання, а для вже повністю зібраного товару система уточнює, чи це нова окрема партія. У відповідному сценарії можна закрити свою палету.": {
        "en": "In Mixed items the label is entered via OCR or manually. The worker then specifies the actual quantity of cartons in hand, then the target SORT pallet number and confirms. PACK is not used as an automatic added quantity. Collection progress is shown, and for an already fully collected item the system asks if this is a new separate batch. In the relevant scenario the worker can close their pallet.",
        "pl": "W trybie Różne towary etykieta jest wprowadzana przez OCR lub ręcznie. Pracownik podaje rzeczywistą ilość kartonów w rękach, następnie numer docelowej palety SORT i potwierdza. PACK nie jest używany jako automatyczna dodana ilość. widoczny jest postęp zbierania, a dla już w pełni zebranego towaru system pyta, czy jest to nowa, oddzielna partia. W odpowiednim scenariuszu można zamknąć swoją paletę.",
        "ru": "В режиме Разные товары наклейку вводят OCR или вручную. Затем работник указывает фактическое количество картонов в руках, потом номер конечного паллета SORT и подтверждает. PACK не используется как автоматическое добавленное количество. Есть прогресс сбора, а для уже полностью собранного товара система уточняет, является ли это новой отдельной партией. В соответствующем сценарии можно закрыть свой паллет.",
    },
    "У Один товар працівник обирає потрібну наклейку, бачить джерельну палету й залишок, вводить її номер, потім підтверджує кожен однаковий картон OCR або вручну. Підказка показує очікувані дані, але їх треба перевірити повторним введенням. Один збіг означає один картон. Коли джерело вичерпано, система показує повідомлення по центру та наступну палету; після останнього джерела повертає до вибору товару. Напрямок обходу перемикається за зростанням або спаданням. Зібране обліковується за працівником, який возить палету із собою; номер кінцевої локації тут не вводять. Є оновлення залишків, скасування останнього відбору та відновлення сесії.": {
        "en": "In One item the worker selects the needed label, sees the source pallet and balance, enters its number, then confirms each identical carton by OCR or manually. The hint shows expected data but it must be verified by re-entry. One match means one carton. When the source is exhausted the system shows a centred message and the next pallet; after the last source it returns to item selection. Traversal direction toggles ascending or descending. Collected items are attributed to the worker who carries the pallet; no final location number is entered here. Balance updates, last pick undo and session restore are available.",
        "pl": "W trybie Jeden towar pracownik wybiera potrzebną etykietę, widzi paletę źródłową i stan, wpisuje jej numer, a następnie potwierdza każdy taki sam karton OCR lub ręcznie. Podpowiedź pokazuje oczekiwane dane, ale należy je zweryfikować ponownym wprowadzeniem. Jedno dopasowanie oznacza jeden karton. Gdy źródło jest wyczerpane, system wyświetla komunikat na środku i następną paletę; po ostatnim źródle wraca do wyboru towaru. Kierunek przejścia przełącza się rosnąco lub malejąco. Zebrane towary są przypisywane do pracownika, który wozi paletę ze sobą; numer lokalizacji końcowej nie jest tu wprowadzany. Dostępne są aktualizacje stanów, cofnięcie ostatniego pobrania i przywrócenie sesji.",
        "ru": "В режиме Один товар работник выбирает нужную наклейку, видит исходный паллет и остаток, вводит его номер, затем подтверждает каждый одинаковый картон OCR или вручную. Подсказка показывает ожидаемые данные, но их нужно проверить повторным вводом. Одно совпадение означает один картон. Когда источник исчерпан, система показывает сообщение по центру и следующий паллет; после последнего источника возвращает к выбору товара. Направление обхода переключается по возрастанию или убыванию. Собранное учитывается за работником, который возит паллет с собой; номер конечной локации здесь не вводится. Есть обновление остатков, отмена последнего отбора и восстановление сессии.",
    },
    "У Один товар після останнього джерела система повідомляє, що товар повністю зібрано, і повертається до сканування чи ручного вибору наступного. Завершити у працівника означає вийти з персонального сценарію, а не закрити завдання для всіх. Усю роботу Sort закриває лише адмін; при цьому відкриті палети закриваються, а підтверджені записи, залишки та історія зберігаються.": {
        "en": "In One item, after the last source the system reports that the item is fully collected and returns to scanning or manual selection of the next one. Finish for the worker means exiting the personal scenario, not closing the task for everyone. Only the admin closes the entire Sort work; open pallets are closed and confirmed records, balances and history remain.",
        "pl": "W trybie Jeden towar, po ostatnim źródle system informuje, że towar jest w pełni zebrany i wraca do skanowania lub ręcznego wyboru następnego. Zakończenie dla pracownika oznacza wyjście z osobistego scenariusza, a nie zamknięcie zadania dla wszystkich. Całą pracę Sort zamyka tylko administrator; otwarte palety są zamykane, a potwierdzone zapisy, stany i historia pozostają.",
        "ru": "В режиме Один товар после последнего источника система сообщает, что товар полностью собран, и возвращается к сканированию или ручному выбору следующего. Завершить для работника означает выйти из личного сценария, а не закрыть задание для всех. Всю работу Sort закрывает только администратор; при этом открытые паллеты закрываются, а подтверждённые записи, остатки и история сохраняются.",
    },
    "Розділ Картони з Pre-sort доступний під час активного Pre-sort і після переведення в Sort. Є зведення за товаром: дані наклейки, додано з PACK, прогрес, кількість палет та розміщення. Журнал показує кожне додавання з палетою, працівником, часом і скасуваннями. Доступні пошук, тип, статус записів та сторінки. Редагована таблиця відтворює основні колонки реального демонстраційного скриншота presort-archive-table: 4567 JP-A 30 PACK, додано 13 картонів на 3 палети: 1 — 6, 4 — 4, 10 — 3. Це початковий підсумок Pre-sort, а не поточний залишок після відбору.": {
        "en": "The Pre-sort cartons section is available during an active Pre-sort and after conversion to Sort. There is an item summary: label data, added vs PACK, progress, pallet count and placement. The log shows each addition with pallet, worker, time and cancellations. Search, type, record status and pages are available. The editable table reproduces the main columns of the real demo screenshot presort-archive-table: 4567 JP-A 30 PACK, 13 cartons added on 3 pallets: 1 — 6, 4 — 4, 10 — 3. This is the initial Pre-sort summary, not the current balance after picking.",
        "pl": "Sekcja kartonów z Pre-sort jest dostępna podczas aktywnego Pre-sort i po przeniesieniu do Sort. Dostępne jest zestawienie według towaru: dane etykiety, dodano z PACK, postęp, liczba palet i rozmieszczenie. Dziennik pokazuje każde dodanie z paletą, pracownikiem, czasem i anulowaniami. Dostępne są wyszukiwanie, typ, status wpisów i strony. Edytowalna tabela odtwarza główne kolumny prawdziwego zrzutu ekranu presort-archive-table: 4567 JP-A 30 PACK, 13 kartonów na 3 paletach: 1 — 6, 4 — 4, 10 — 3. To wstępne podsumowanie Pre-sort, a nie aktualny stan po pobraniu.",
        "ru": "Раздел Картоны из Pre-sort доступен во время активного Pre-sort и после перевода в Sort. Есть сводка по товару: данные наклейки, добавлено из PACK, прогресс, количество паллетов и размещение. Журнал показывает каждое добавление с паллетом, работником, временем и отменами. Доступны поиск, тип, статус записей и страницы. Редактируемая таблица воспроизводит основные колонки реального демонстрационного скриншота presort-archive-table: 4567 JP-A 30 PACK, добавлено 13 картонов на 3 паллета: 1 — 6, 4 — 4, 10 — 3. Это начальный итог Pre-sort, а не текущий остаток после отбора.",
    },
    "Рухи та залишки показують поточний стан: очікувану й зібрану кількість товарів, палети й баланс, працівників та час активності. Є історія рухів із часом, автором, причиною й операцією. Під час відбору віднімається картон на джерелі й додається до зібраного працівником. Залишок рахується за рухами. Цей стан треба відрізняти від початкового архіву Pre-sort.": {
        "en": "Movements and balances show the current state: expected and collected item quantities, pallets and balance, workers and activity time. Movement history shows time, author, reason and operation. During picking, a carton is subtracted from the source and added to the worker's collected total. The balance is calculated from movements. This state must be distinguished from the initial Pre-sort archive.",
        "pl": "Ruchy i stany pokazują aktualny stan: oczekiwaną i zebraną ilość towarów, palety i saldo, pracowników i czas aktywności. Historia ruchów zawiera czas, autora, powód i operację. Podczas pobierania karton jest odejmowany od źródła i dodawany do zebranego przez pracownika. Stan jest obliczany na podstawie ruchów. Ten stan należy odróżnić od pierwotnego archiwum Pre-sort.",
        "ru": "Движения и остатки показывают текущее состояние: ожидаемое и собранное количество товаров, паллеты и баланс, работников и время активности. История движений содержит время, автора, причину и операцию. При отборе картон вычитается из источника и добавляется к собранному работником. Остаток считается по движениям. Это состояние нужно отличать от исходного архива Pre-sort.",
    },
    "У Sort: товари й завдання адміністратор бачить товари в роботі, завершені товари, палети SORT і створення завдань; є прогрес і фільтри за типом і відкритим/закритим станом. Статуси завдань можна відфільтрувати. Активне незавершене завдання також можна видалити через Так/Ні: це логічне приховування зі збереженням облікової історії. В адмінпанелі можна створити user або admin, побачити ролі, онлайн/офлайн, лічильник картонів і дату реєстрації, видалити звичайного користувача.": {
        "en": "In Sort: items and tasks the admin sees items in progress, completed items, SORT pallets and task creation; there is progress and filters by type and open/closed status. Task statuses can be filtered. An active unfinished task can also be deleted via Yes/No: this is logical hiding while preserving accounting history. In the admin panel you can create a user or admin, see roles, online/offline status, carton counter and registration date, and delete a regular user.",
        "pl": "W Sort: towary i zadania administrator widzi towary w trakcie pracy, zakończone towary, palety SORT i tworzenie zadań; dostępny jest postęp i filtry według typu i stanu otwartego/zamkniętego. Statusy zadań można filtrować. Aktywne niezakończone zadanie można również usunąć przez Tak/Nie: to logiczne ukrycie z zachowaniem historii księgowej. W panelu administracyjnym można utworzyć użytkownika lub administratora, zobaczyć role, status online/offline, licznik kartonów i datę rejestracji, usunąć zwykłego użytkownika.",
        "ru": "В Sort: товары и задания администратор видит товары в работе, завершённые товары, паллеты SORT и создание заданий; есть прогресс и фильтры по типу и открытому/закрытому состоянию. Статусы заданий можно отфильтровать. Активное незавершённое задание также можно удалить через Да/Нет: это логическое скрытие с сохранением учётной истории. В панели администратора можно создать пользователя или администратора, увидеть роли, онлайн/офлайн, счётчик картонов и дату регистрации, удалить обычного пользователя.",
    },
    "Адміністратор може змінити очікувану кількість, номер та відкритий/закритий стан звичайної палети, додати чи списати залишок із причиною, списати весь залишок палети. Номер пересувної палети працівника не редагують. Дозволений рух можна виправити компенсацією та новим рухом; операції сортування не редагують напряму, використовують Undo або окреме коригування. Перевірка доступного залишку транзакційна, а ідентифікатор запиту захищає від повторного збереження. Налаштування формату ICC для завдання наразі читає керований відбір Один товар; звичайний Sort та Pre-sort мають власну валідацію. Не слід представляти це як глобальне вимкнення перевірок.": {
        "en": "The administrator can change the expected quantity, number and open/closed status of a regular pallet, add or write off the balance with a reason, and write off the entire pallet balance. The mobile pallet number of a worker is not edited. An allowed movement can be corrected with a compensation and a new movement; sorting operations are not edited directly — use Undo or a separate adjustment. The available balance check is transactional and the request identifier prevents duplicate saving. The ICC format setting for a task currently reads managed One item picking; regular Sort and Pre-sort have their own validation. This should not be presented as a global disabling of checks.",
        "pl": "Administrator może zmienić oczekiwaną ilość, numer i stan otwartego/zamkniętego zwykłej palety, dodać lub odpisać stan z powodem oraz odpisać cały stan palety. Numer mobilnej palety pracownika nie jest edytowany. Dozwolony ruch można skorygować kompensacją i nowym ruchem; operacje sortowania nie są edytowane bezpośrednio — używa się Undo lub osobnej korekty. Sprawdzanie dostępnego stanu jest transakcyjne, a identyfikator żądania chroni przed ponownym zapisem. Ustawienie formatu ICC dla zadania odczytuje aktualnie zarządzane pobieranie Jeden towar; zwykłe Sort i Pre-sort mają własną walidację. Nie należy przedstawiać tego jako globalnego wyłączenia kontroli.",
        "ru": "Администратор может изменить ожидаемое количество, номер и открытый/закрытый статус обычного паллета, добавить или списать остаток с причиной, списать весь остаток паллета. Номер мобильного паллета работника не редактируется. Разрешённое движение можно исправить компенсацией и новым движением; операции сортировки не редактируются напрямую — используют Undo или отдельную корректировку. Проверка доступного остатка транзакционная, а идентификатор запроса защищает от повторного сохранения. Настройка формата ICC для задания сейчас читает управляемый отбор Один товар; обычные Sort и Pre-sort имеют собственную валидацию. Не следует представлять это как глобальное отключение проверок.",
    },
    "Активність показує час, користувача, дію та деталі; є загальний перегляд і вибір окремого працівника. OCR Логи містять фото наклейки, розпізнані дані, сирий OCR, час, користувача, успіх/невдачу й ручні виправлення. Є фільтри за типом і результатом, порядок дат. Це інструменти пошуку помилок і контролю, а не необмежений архів: активність повертає до 100 записів, OCR до 200, історія рухів до 1000. Таблиця на слайді — реальний журнал дій на тимчасових даних.": {
        "en": "Activity shows time, user, action and details; there is an overall view and selection of an individual worker. OCR Logs contain the label photo, recognised data, raw OCR, time, user, success/failure and manual corrections. Filters by type and result and date order are available. These are error search and control tools, not an unlimited archive: activity returns up to 100 records, OCR up to 200, movement history up to 1000. The table on the slide is a real action log on temporary data.",
        "pl": "Aktywność pokazuje czas, użytkownika, działanie i szczegóły; dostępny jest ogólny widok i wybór pojedynczego pracownika. Logi OCR zawierają zdjęcie etykiety, rozpoznane dane, surowy OCR, czas, użytkownika, sukces/niepowodzenie i ręczne poprawki. Dostępne są filtry według typu i wyniku oraz kolejność dat. Są to narzędzia wyszukiwania błędów i kontroli, a nie nieograniczone archiwum: aktywność zwraca do 100 wpisów, OCR do 200, historia ruchów do 1000. Tabela na slajdzie to prawdziwy dziennik działań na tymczasowych danych.",
        "ru": "Активность показывает время, пользователя, действие и детали; есть общий просмотр и выбор отдельного работника. OCR Логи содержат фото наклейки, распознанные данные, сырой OCR, время, пользователя, успех/неудачу и ручные исправления. Есть фильтры по типу и результату, порядок дат. Это инструменты поиска ошибок и контроля, а не неограниченный архив: активность возвращает до 100 записей, OCR до 200, история движений до 1000. Таблица на слайде — реальный журнал действий на временных данных.",
    },
    "Основні режими лише два. Pre-sort потрібний, коли товар розвантажують на змішані палети: він створює карту розміщення. Sort використовується для звичайного сортування або керованого збирання однакових картонів із цієї карти. Збережені дані надалі доступні для контролю й керування роботою.": {
        "en": "There are only two main modes. Pre-sort is needed when items are unloaded onto mixed pallets: it creates a placement map. Sort is used for regular sorting or managed collection of identical cartons from this map. Saved data remains available for monitoring and managing the work.",
        "pl": "Są tylko dwa główne tryby. Pre-sort jest potrzebny, gdy towary są rozładowywane na mieszane palety: tworzy mapę rozmieszczenia. Sort jest używany do zwykłego sortowania lub zarządzanego zbierania takich samych kartonów z tej mapy. Zapisane dane pozostają dostępne do kontroli i zarządzania pracą.",
        "ru": "Основных режимов только два. Pre-sort нужен, когда товар разгружают на смешанные паллеты: он создаёт карту размещения. Sort используется для обычной сортировки или управляемого сбора одинаковых картонов с этой карты. Сохранённые данные остаются доступными для контроля и управления работой.",
    },
    "Подякуйте за увагу та запросіть запитання щодо реєстрації, роботи з Pre-sort і Sort, збережених даних та адміністрування.": {
        "en": "Thank the audience for their attention and invite questions about registration, working with Pre-sort and Sort, saved data and administration.",
        "pl": "Podziękuj za uwagę i zaproś do pytań dotyczących rejestracji, pracy z Pre-sort i Sort, zapisanych danych oraz administracji.",
        "ru": "Поблагодарите за внимание и пригласите к вопросам о регистрации, работе с Pre-sort и Sort, сохранённых данных и администрировании.",
    },
    "На початковій сторінці є Вхід і Реєстрація. Новий користувач вводить логін, пароль і його підтвердження, потім входить у свій акаунт. Самореєстрація створює звичайного працівника. Адміністратор може окремо створювати працівників та адміністраторів через панель. Джерело: чинний інтерфейс і код Warehouse System.": {
        "en": "The start page has Login and Register. A new user enters the login, password and its confirmation, then logs in. Self-registration creates a regular worker. The administrator can separately create workers and administrators through the panel. Source: current Warehouse System interface and code.",
        "pl": "Strona startowa ma Logowanie i Rejestrację. Nowy użytkownik wpisuje login, hasło i jego potwierdzenie, a następnie loguje się. Samoregistracja tworzy zwykłego pracownika. Administrator może osobno tworzyć pracowników i administratorów przez panel. Źródło: aktualny interfejs i kod Warehouse System.",
        "ru": "На стартовой странице есть Вход и Регистрация. Новый пользователь вводит логин, пароль и его подтверждение, затем входит в свой аккаунт. Самостоятельная регистрация создаёт обычного работника. Администратор может отдельно создавать работников и администраторов через панель. Источник: действующий интерфейс и код Warehouse System.",
    },
    "На головному екрані окремі кнопки SORT і PRE-SORT. Адміністратор додатково бачить Адмін. Лідер і адмін у цьому проєкті означають ту саму роль. Для початку роботи обирають уже створене завдання; додаткового вибору контейнера або резервування робочого місця в поточному інтерфейсі немає.": {
        "en": "The main screen has separate SORT and PRE-SORT buttons. The administrator additionally sees Admin. Leader and admin in this project mean the same role. To start working, an already created task is selected; there is no additional container selection or workstation booking in the current interface.",
        "pl": "Główny ekran ma osobne przyciski SORT i PRE-SORT. Administrator widzi dodatkowo Admin. Lider i administrator w tym projekcie oznaczają tę samą rolę. Aby rozpocząć pracę, wybiera się już utworzone zadanie; w obecnym interfejsie nie ma dodatkowego wyboru kontenera ani rezerwacji stanowiska pracy.",
        "ru": "На главном экране отдельные кнопки SORT и PRE-SORT. Администратор дополнительно видит Admin. Лидер и администратор в этом проекте означают одну и ту же роль. Для начала работы выбирают уже созданное задание; дополнительного выбора контейнера или бронирования рабочего места в текущем интерфейсе нет.",
    },
    "Завдання має власний ID, назву з локації, дату, дозволені типи та статус. Облік і палети різних завдань відокремлені. Це потрібно не лише для сьогоднішнього сортування: надалі адміністратор може знайти потрібний набір даних, переглянути результат, початкове розміщення, учасників і журнал операцій. Це чинні можливості, а не обіцянка майбутніх модулів аналітики.": {
        "en": "A task has its own ID, name from location, date, allowed types and status. Accounting and pallets of different tasks are separated. This is needed not only for today's sorting: later the administrator can find the needed data set, view the result, initial placement, participants and operation log. These are current capabilities, not a promise of future analytics modules.",
        "pl": "Zadanie ma własny ID, nazwę z lokalizacji, datę, dozwolone typy i status. Ewidencja i palety różnych zadań są oddzielone. Jest to potrzebne nie tylko do dzisiejszego sortowania: późniejszy administrator może znaleźć potrzebny zestaw danych, przejrzeć wynik, wstępne rozmieszczenie, uczestników i dziennik operacji. Są to obecne możliwości, a nie obietnica przyszłych modułów analitycznych.",
        "ru": "Задание имеет собственный ID, название из локации, дату, разрешённые типы и статус. Учёт и паллеты разных заданий разделены. Это нужно не только для сегодняшней сортировки: впоследствии администратор может найти нужный набор данных, просмотреть результат, начальное размещение, участников и журнал операций. Это действующие возможности, а не обещание будущих модулей аналитики.",
    },
    "Створювати Sort і Pre-sort може лише адміністратор. У формі немає довільного поля назви: назва дорівнює вибраній локації, наприклад Rampa 3. Доступні Zona Single A–C, Zona Mix A–C та Rampa 1–9. Потрібно вибрати хоча б один дозволений тип, Single або Mix. Порожня дата стає поточною; примітки необов'язкові. Кнопка показує Створити SORT або Створити PRE-SORT відповідно до режиму. Скриншот показує верхні поля реальної форми.": {
        "en": "Only an administrator can create Sort and Pre-sort. There is no free-text name field in the form: the name equals the selected location, e.g. Rampa 3. Available locations: Zona Single A–C, Zona Mix A–C and Rampa 1–9. At least one allowed type, Single or Mix, must be selected. An empty date becomes the current date; notes are optional. The button shows Create SORT or Create PRE-SORT according to the mode. The screenshot shows the top fields of the real form.",
        "pl": "Tylko administrator może tworzyć Sort i Pre-sort. W formularzu nie ma dowolnego pola nazwy: nazwa jest równa wybranej lokalizacji, np. Rampa 3. Dostępne lokalizacje: Zona Single A–C, Zona Mix A–C i Rampa 1–9. Należy wybrać co najmniej jeden dozwolony typ, Single lub Mix. Pusta data staje się bieżącą; notatki są opcjonalne. Przycisk pokazuje Utwórz SORT lub Utwórz PRE-SORT w zależności od trybu. Zrzut ekranu pokazuje górne pola prawdziwego formularza.",
        "ru": "Создавать Sort и Pre-sort может только администратор. В форме нет произвольного поля названия: название равно выбранной локации, например Rampa 3. Доступные локации: Zona Single A–C, Zona Mix A–C и Rampa 1–9. Нужно выбрать хотя бы один разрешённый тип, Single или Mix. Пустая дата становится текущей; примечания необязательны. Кнопка показывает Создать SORT или Создать PRE-SORT согласно режиму. Скриншот показывает верхние поля реальной формы.",
    },
    "OCR використовує камеру: користувач розміщує наклейку в рамці й натискає Зробити фото. За підтримки пристрою є спалах. Повний коректний результат автоматично продовжує відповідний сценарій. Неповні дані не створюють рух; їх можна доповнити вручну. Ручний шлях завжди доступний: Single має ICC, PACK, кодові букви, Mix — свій код із наклейки. Приклад Single 4567 / 30 PACK / JP-A. Підтвердження кнопкою або Enter. PACK є характеристикою наклейки, а не кількістю картонів у руках.": {
        "en": "OCR uses the camera: the user places the label in the frame and presses Take photo. Flash is available when the device supports it. A full correct result automatically continues the relevant scenario. Incomplete data does not create a movement; it can be completed manually. The manual path is always available: Single has ICC, PACK, code letters, Mix has its own label code. Single example: 4567 / 30 PACK / JP-A. Confirm with button or Enter. PACK is a label characteristic, not the number of cartons in hand.",
        "pl": "OCR używa kamery: użytkownik umieszcza etykietę w ramce i naciska Zrób zdjęcie. Lampa błyskowa jest dostępna gdy urządzenie to obsługuje. Pełny poprawny wynik automatycznie kontynuuje odpowiedni scenariusz. Niekompletne dane nie tworzą ruchu; można je uzupełnić ręcznie. Ścieżka ręczna jest zawsze dostępna: Single ma ICC, PACK, litery kodu, Mix ma własny kod z etykiety. Przykład Single: 4567 / 30 PACK / JP-A. Potwierdzenie przyciskiem lub Enter. PACK jest cechą etykiety, a nie liczbą kartonów w rękach.",
        "ru": "OCR использует камеру: пользователь размещает наклейку в рамке и нажимает Зробити фото. При поддержке устройства доступна вспышка. Полный корректный результат автоматически продолжает соответствующий сценарий. Неполные данные не создают движения; их можно дополнить вручную. Ручной путь всегда доступен: Single имеет ICC, PACK, кодовые буквы, Mix — свой код с наклейки. Пример Single: 4567 / 30 PACK / JP-A. Подтверждение кнопкой или Enter. PACK является характеристикой наклейки, а не количеством картонов в руках.",
    },
    "Сканування починається кнопкою Сканувати. Після дозволу камери користувач уміщує наклейку в рамку й натискає Зробити фото. Камера не фотографує сама без цього натискання. У Single потрібні ICC, PACK та кодові букви; у Mix — код наклейки. Повний коректний результат автоматично продовжує поточний сценарій: Pre-sort додає один картон і залишає камеру відкритою; Різні товари переходить до фактичної кількості; Один товар підтверджує один збіг. Неповний результат можна пересканувати або доповнити вручну. За підтримки пристрою доступний Спалах.": {
        "en": "Scanning starts with the Scan button. After camera permission the user places the label in the frame and presses Take photo. The camera does not photograph automatically without this press. Single requires ICC, PACK and code letters; Mix requires the label code. A full correct result automatically continues the current scenario: Pre-sort adds one carton and leaves the camera open; Mixed items moves to the actual quantity; One item confirms one match. An incomplete result can be rescanned or completed manually. Flash is available when the device supports it.",
        "pl": "Skanowanie rozpoczyna się przyciskiem Skanuj. Po udzieleniu dostępu do kamery użytkownik umieszcza etykietę w ramce i naciska Zrób zdjęcie. Kamera nie fotografuje automatycznie bez tego naciśnięcia. Single wymaga ICC, PACK i liter kodu; Mix wymaga kodu etykiety. Pełny poprawny wynik automatycznie kontynuuje bieżący scenariusz: Pre-sort dodaje jeden karton i pozostawia kamerę otwartą; Różne towary przechodzi do rzeczywistej ilości; Jeden towar potwierdza jedno dopasowanie. Niekompletny wynik można ponownie zeskanować lub uzupełnić ręcznie. Lampa błyskowa jest dostępna gdy urządzenie to obsługuje.",
        "ru": "Сканирование начинается кнопкой Сканировать. После разрешения камеры пользователь помещает наклейку в рамку и нажимает Зробити фото. Камера не фотографирует сама без этого нажатия. В Single нужны ICC, PACK и кодовые буквы; в Mix — код наклейки. Полный корректный результат автоматически продолжает текущий сценарий: Pre-sort добавляет один картон и оставляет камеру открытой; Разные товары переходит к фактическому количеству; Один товар подтверждает одно совпадение. Неполный результат можно пересканировать или дополнить вручную. При поддержке устройства доступна Вспышка.",
        },
    "Джерело інтерфейсу: справжня OCR-форма Warehouse System, знята в браузері на окремій тимчасовій базі. Фізична камера не використовувалася. Зображення коробки й наклейки створене для демонстрації за допомогою imagegen; це приклад кадру, а не доказ проведеного OCR.": {
        "en": "Interface source: the real Warehouse System OCR form, captured in the browser on a separate temporary database. No physical camera was used. The box and label image was created for demonstration using imagegen; it is an example frame, not proof of an OCR being performed.",
        "pl": "Źródło interfejsu: prawdziwy formularz OCR Warehouse System, przechwycony w przeglądarce na oddzielnej tymczasowej bazie danych. Nie użyto fizycznej kamery. Obraz pudełka i etykiety został stworzony do celów demonstracyjnych przy użyciu imagegen; jest to przykładowa klatka, a nie dowód przeprowadzenia OCR.",
        "ru": "Источник интерфейса: реальная OCR-форма Warehouse System, снятая в браузере на отдельной временной базе. Физическая камера не использовалась. Изображение коробки и наклейки создано для демонстрации с помощью imagegen; это пример кадра, а не доказательство проведённого OCR.",
    },
    "Працівник обирає створене адміністратором завдання Pre-sort і відкриває пронумеровану палету. Кожна підтверджена наклейка додає один картон, OCR або вручну. З'являється повідомлення про додавання; після OCR камера залишається відкритою. Повну палету закривають і починають наступну. Є підсумки, список палет, скасування останнього картона й повтор непідтвердженого збереження. Пошуку місць зберігання в робочому Pre-sort немає.": {
        "en": "The worker selects the admin-created Pre-sort task and opens a numbered pallet. Each confirmed label adds one carton, by OCR or manually. An addition message appears; after OCR the camera stays open. A full pallet is closed and the next one started. Summaries, pallet list, last carton cancel and retry of unconfirmed save are available. There is no storage location search in the working Pre-sort.",
        "pl": "Pracownik wybiera zadanie Pre-sort utworzone przez administratora i otwiera ponumerowaną paletę. Każda potwierdzona etykieta dodaje jeden karton, przez OCR lub ręcznie. Pojawia się komunikat o dodaniu; po OCR kamera pozostaje otwarta. Pełna paleta jest zamykana i rozpoczyna się następna. Dostępne są podsumowania, lista palet, anulowanie ostatniego kartonu i ponowienie niezatwierdzonego zapisu. W roboczym Pre-sort nie ma wyszukiwania miejsc przechowywania.",
        "ru": "Работник выбирает созданное администратором задание Pre-sort и открывает пронумерованный паллет. Каждая подтверждённая наклейка добавляет один картон, OCR или вручную. Появляется сообщение о добавлении; после OCR камера остаётся открытой. Полный паллет закрывают и начинают следующий. Есть итоги, список паллетов, отмена последнего картона и повтор неподтверждённого сохранения. Поиска мест хранения в рабочем Pre-sort нет.",
    },
}


def translate_xml(xml_bytes, lang, is_note=False):
    """Replace Ukrainian text runs in a slide or notes XML."""
    ns_uri = "http://schemas.openxmlformats.org/drawingml/2006/main"
    ET.register_namespace("a", ns_uri)
    # parse preserving all namespaces
    root = ET.fromstring(xml_bytes)

    def ns(tag):
        return "{%s}%s" % (ns_uri, tag)

    table = NOTES_TRANS if is_note else SLIDE_TRANS

    for t_elem in root.iter(ns("t")):
        text = t_elem.text
        if not text:
            continue
        stripped = text.strip()
        if stripped in table and lang in table[stripped]:
            # Preserve leading/trailing whitespace
            lead = text[: len(text) - len(text.lstrip())]
            trail = text[len(text.rstrip()) :]
            t_elem.text = lead + table[stripped][lang] + trail

    return ET.tostring(root, encoding="unicode", xml_declaration=False)


def create_translated(src_path, dst_path, lang):
    shutil.copy2(src_path, dst_path)
    ns_uri = "http://schemas.openxmlformats.org/drawingml/2006/main"

    with zipfile.ZipFile(src_path, "r") as zin:
        names = zin.namelist()
        slide_names = [n for n in names if n.startswith("ppt/slides/slide") and n.endswith(".xml")]
        note_names = [n for n in names if n.startswith("ppt/notesSlides/") and n.endswith(".xml")]

        # Read all content
        contents = {}
        for name in names:
            contents[name] = zin.read(name)

    # Translate slides
    for name in slide_names:
        translated = translate_xml(contents[name], lang, is_note=False)
        contents[name] = translated.encode("utf-8")

    # Translate notes
    for name in note_names:
        translated = translate_xml(contents[name], lang, is_note=True)
        contents[name] = translated.encode("utf-8")

    # Write new zip
    import tempfile
    tmp = dst_path + ".tmp"
    with zipfile.ZipFile(src_path, "r") as zin:
        with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                if item.filename in contents and isinstance(contents[item.filename], bytes):
                    zout.writestr(item, contents[item.filename])
                else:
                    zout.writestr(item, zin.read(item.filename))

    if os.path.exists(dst_path):
        os.remove(dst_path)
    os.rename(tmp, dst_path)
    print(f"Created: {dst_path}")


if __name__ == "__main__":
    for lang, dst in LANGS.items():
        create_translated(SRC, dst, lang)
    print("Done.")
