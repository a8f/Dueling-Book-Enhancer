"""Optional independent Draft 2020-12 QA. Requires Python jsonschema, not used by builds/runtime."""
import json
import subprocess
from pathlib import Path
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

root = Path(__file__).resolve().parents[1]
schemas = [json.loads((root / 'schemas' / name).read_text(encoding='utf-8'))
           for name in ['card-action-v3.schema.json', 'card-rule-list-v4.schema.json']]
registry = Registry()
for schema in schemas:
    Draft202012Validator.check_schema(schema)
    registry = registry.with_resource(schema['$id'], Resource.from_contents(schema))
validators = dict(zip(['action', 'list'], [Draft202012Validator(schema, registry=registry) for schema in schemas]))

def action_semantics(value):
    if not isinstance(value, dict):
        return False
    activation, filters, timing = value.get('activation'), value.get('filters'), value.get('timing')
    if not all(isinstance(item, dict) for item in [activation, filters, timing]):
        return False
    choices = activation.get('choices')
    if not isinstance(choices, list) or not all(isinstance(choice, dict) for choice in choices):
        return False
    if any(not isinstance(choice.get('id'), str) for choice in choices):
        return False
    by_id = {choice.get('id'): choice for choice in choices}
    if len(by_id) != len(choices):
        return False
    filter_ids = set(filters)
    costs = activation.get('costs')
    if not isinstance(costs, list):
        return False
    if any(cost.get('filter') not in filter_ids for cost in costs if isinstance(cost, dict) and cost.get('filter')):
        return False
    valid = True
    required = {'activation-legality', 'responses-and-chains', 'negation', 'replacement-and-protection', 'movement-consequences'}
    def operations(items):
        nonlocal valid
        if not isinstance(items, list):
            valid = False
            return
        for operation in items:
            if not isinstance(operation, dict):
                valid = False
                continue
            if operation.get('filter') and (not isinstance(operation['filter'], str) or operation['filter'] not in filter_ids):
                valid = False
            if operation.get('op') == 'special-summon':
                required.add('special-summon-legality')
                position = operation.get('position') if isinstance(operation.get('position'), dict) else {}
                reference = position.get('choice')
                if not isinstance(reference, str) or by_id.get(reference, {}).get('kind') != 'position':
                    valid = False
            if operation.get('op') == 'destroy':
                selection = operation.get('selection') if isinstance(operation.get('selection'), dict) else {}
                maximum = selection.get('maximum') if isinstance(selection.get('maximum'), dict) else {}
                count = maximum.get('count') if isinstance(maximum.get('count'), dict) else {}
                if not isinstance(count.get('filter'), str) or count.get('filter') not in filter_ids:
                    valid = False
                if selection.get('players') == 'both':
                    required.add('opponent-movement')
            if operation.get('op') == 'branch':
                reference = operation.get('choice')
                choice = by_id.get(reference, {}) if isinstance(reference, str) else {}
                cases = operation.get('cases') if isinstance(operation.get('cases'), dict) else {}
                options = choice.get('options') if isinstance(choice.get('options'), list) else []
                if choice.get('kind') != 'option' or any(not isinstance(option, str) for option in options) or set(cases) != set(options):
                    valid = False
                if isinstance(cases, dict):
                    for branch in cases.values():
                        operations(branch)
    operations(value.get('resolution'))
    trigger = timing.get('kind') == 'optional-trigger'
    if trigger != (isinstance(timing.get('events'), list) and timing.get('damageStep') is True):
        valid = False
    if trigger:
        required.add('trigger-window')
    if timing.get('oncePerTurn'):
        required.add('once-per-turn')
    if filter_ids:
        required.add('dynamic-card-properties')
    coverage_value = value.get('coverage') if isinstance(value.get('coverage'), dict) else {}
    manual = coverage_value.get('manual', [])
    return valid and isinstance(manual, list) and all(code in manual for code in required)

cases = json.loads(subprocess.check_output(['node', 'tests/fixtures/automation-contract-corpus.cjs'], cwd=root, encoding='utf-8'))
for case in cases:
    errors = list(validators[case['kind']].iter_errors(case['value']))
    action = case['value']
    if case['kind'] == 'list':
        rules = action.get('rules') if isinstance(action, dict) else None
        first = rules[0] if isinstance(rules, list) and rules else None
        action = first.get('action') if isinstance(first, dict) else None
    semantic = action_semantics(action)
    if (not errors and semantic) != case['valid']:
        raise AssertionError(f"Schema/runtime mismatch: {case['kind']} {case['path']}: {errors[:1]}")
print(f"Both Draft 2020-12 schemas checked; {len(cases)} structural cases agree with runtime validation.")
