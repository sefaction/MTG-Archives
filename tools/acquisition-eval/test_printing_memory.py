import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'acquisition-runtime'))
import printing_worker
import printing


class PrintingMemoryTests(unittest.TestCase):
    def test_decoder_keeps_identity_integrity_and_preview_fields_without_unused_catalogue_payload(self):
        record = {'referenceId':'card:0','cardId':'card','file':'image.jpg','sha256':'a'*64,
                  'url':'https://cards.scryfall.io/public.jpg','name':'unused'*100000,
                  'verifiedStat':{'mtime':123,'bytes':999},'face':0,'collectorNumber':'001'}
        encoded = json.dumps([record])
        decoded = json.loads(encoded, object_hook=printing_worker.compact_reference_record)
        self.assertEqual(decoded, [{key:record[key] for key in ('referenceId','cardId','file','sha256','url')}])
        self.assertEqual(json.dumps([record]), encoded)
        self.assertEqual(printing_worker.compact_reference_record({'unrelated':1}),{'unrelated':1})
        missing = {key:value for key,value in record.items() if key!='url'}
        self.assertNotIn('url', printing_worker.compact_reference_record(missing))

    def test_allocator_cleanup_collects_first_and_never_alters_live_objects(self):
        events=[];live={'pixels':[1,2,3]}
        with (patch.object(printing.gc,'collect',side_effect=lambda:events.append('collect')),
              patch.object(printing,'_trim',side_effect=lambda n:events.append(('trim',n)))):
            printing_worker.release_temporary_memory()
        self.assertEqual(events,['collect',('trim',0)])
        self.assertEqual(live,{'pixels':[1,2,3]})
        with patch.object(printing,'_trim',None),patch.object(printing.gc,'collect') as collect:
            printing_worker.release_temporary_memory();collect.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
