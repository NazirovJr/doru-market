# Разрешает конфликты «обе стороны добавили»: ours, затем theirs. Из theirs убираются только
# дубли строк-членов (с буквами), скобки и пунктуация сохраняются. Результат ОБЯЗАТЕЛЬНО проверять typecheck.
# Использование: python union-merge.py <файл-с-маркерами-конфликта> [...]
import io, re, sys
has_word = re.compile(r'[A-Za-zА-Яа-я_]')
for path in sys.argv[1:]:
    lines = io.open(path, encoding='utf-8', newline='').read().split('\n')
    out, state, ours, theirs = [], None, [], []
    for line in lines:
        if line.startswith('<<<<<<< '):
            state, ours, theirs = 'ours', [], []
        elif line.startswith('=======') and state == 'ours':
            state = 'theirs'
        elif line.startswith('>>>>>>> ') and state == 'theirs':
            ours_set = {l.strip() for l in ours if has_word.search(l)}
            out += ours + [l for l in theirs if not (has_word.search(l) and l.strip() in ours_set)]
            state = None
        elif state == 'ours':
            ours.append(line)
        elif state == 'theirs':
            theirs.append(line)
        else:
            out.append(line)
    io.open(path, 'w', encoding='utf-8', newline='').write('\n'.join(out))
    print('resolved', path)
