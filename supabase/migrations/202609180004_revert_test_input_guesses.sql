-- Revert the temporary browser-test guesses back to the source's unknown values.
update public.spec_items
set unit = null
where source_document_id in (select id from public.source_documents where original_filename='mcv-barys-2025.xlsx')
  and position in ('1.13','6.1','7','8.13');
update public.spec_items
set quantity = null
where source_document_id in (select id from public.source_documents where original_filename='mcv-barys-2025.xlsx')
  and position='8.13';
