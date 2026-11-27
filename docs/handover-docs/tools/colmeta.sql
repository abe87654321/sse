-- 生成目标库的列结构元数据（供 filter_insert_columns.py 使用）
-- 输出单行 JSON
SELECT json_build_object(
  'tables',
  (
    SELECT json_object_agg(
             c1.table_name,
             json_build_object(
               'cols', (
                 SELECT json_object_agg(
                          c2.column_name,
                          json_build_object(
                            'notnull', c2.is_nullable = 'NO',
                            'default', c2.column_default
                          )
                          ORDER BY c2.ordinal_position
                        )
                 FROM information_schema.columns c2
                 WHERE c2.table_schema = 'public'
                   AND c2.table_name = c1.table_name
               ),
               'order', (
                 SELECT json_agg(c3.column_name ORDER BY c3.ordinal_position)
                 FROM information_schema.columns c3
                 WHERE c3.table_schema = 'public'
                   AND c3.table_name = c1.table_name
               )
             )
           )
    FROM (SELECT DISTINCT table_name
          FROM information_schema.columns
          WHERE table_schema = 'public') c1
  )
) AS colmeta;
