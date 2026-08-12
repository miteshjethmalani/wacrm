-- Add send_http_request node type to flow_nodes
-- Migration to support HTTP request nodes in flow builder

ALTER TABLE flow_nodes
  DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;

ALTER TABLE flow_nodes
  ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    'start',
    'send_buttons',
    'send_list',
    'send_message',
    'send_media',
    'collect_input',
    'condition',
    'send_http_request',
    'set_tag',
    'handoff',
    'http_fetch',
    'end'
  ));
