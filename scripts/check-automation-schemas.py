"""Optional independent Draft 2020-12 QA. Requires Python jsonschema, not used by builds/runtime."""
import json
import subprocess
from pathlib import Path
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

root = Path(__file__).resolve().parents[1]
schemas = [json.loads((root / 'schemas' / name).read_text(encoding='utf-8'))
           for name in ['card-action-v2.schema.json', 'card-rule-list-v4.schema.json']]
registry = Registry()
for schema in schemas:
    Draft202012Validator.check_schema(schema)
    registry = registry.with_resource(schema['$id'], Resource.from_contents(schema))
validators = dict(zip(['action', 'list'], [Draft202012Validator(schema, registry=registry) for schema in schemas]))
cases = json.loads(subprocess.check_output(['node', 'tests/fixtures/automation-contract-corpus.cjs'], cwd=root, encoding='utf-8'))
for case in cases:
    errors = list(validators[case['kind']].iter_errors(case['value']))
    if (not errors) != case['valid']:
        raise AssertionError(f"Schema/runtime mismatch: {case['kind']} {case['path']}: {errors[:1]}")
print(f"Both Draft 2020-12 schemas checked; {len(cases)} structural cases agree with runtime validation.")
