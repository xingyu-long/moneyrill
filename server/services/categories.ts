import { pool } from '../db/pool.ts';
import {
  createCategoryBody,
  createGroupBody,
  ensure,
  updateCategoryBody,
  updateGroupBody,
} from '../lib/schemas.ts';

const notFound = (what: string) =>
  Object.assign(new Error(`${what} not found`), { statusCode: 404 });

function duplicate(what: string, e: any): never {
  if (e?.code === '23505') throw new Error(`A ${what} with that name already exists`);
  throw e;
}

/** Groups (with their type) and the categories in them, in display order. */
export async function listCategories() {
  const groups = (
    await pool.query(
      `SELECT id,type,name,sort_order FROM category_groups
       ORDER BY CASE type WHEN 'income' THEN 1 WHEN 'expense' THEN 2 ELSE 3 END,sort_order,lower(name)`,
    )
  ).rows;
  const categories = (
    await pool.query(
      `SELECT c.id,c.name,c.emoji,c.group_id,g.name AS group_name,g.type,c.key,c.sort_order,coalesce(n.count,0)::int AS transaction_count
       FROM categories c JOIN category_groups g ON g.id=c.group_id
       LEFT JOIN (
         -- an unsplit transaction counts once; a split one counts once per part
         SELECT cid AS id,count(*) AS count FROM (
           SELECT coalesce(uc.id,rc.id,ac.id,un.id) AS cid FROM transactions t
           LEFT JOIN categories uc ON uc.id=t.category_id
           LEFT JOIN categories rc ON rc.id=t.rule_category_id
           LEFT JOIN categories ac ON ac.key=t.auto_category_key
           LEFT JOIN categories un ON un.key='uncategorized'
           WHERE t.removed_at IS NULL AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id=t.id)
           UNION ALL
           SELECT coalesce(sc.id,un.id) FROM transaction_splits s
           JOIN transactions t ON t.id=s.transaction_id AND t.removed_at IS NULL
           LEFT JOIN categories sc ON sc.id=s.category_id
           LEFT JOIN categories un ON un.key='uncategorized'
           UNION ALL
           SELECT coalesce(category_id,rule_category_id) FROM investment_transactions
           WHERE removed_at IS NULL AND coalesce(category_id,rule_category_id) IS NOT NULL) x
         GROUP BY 1) n ON n.id=c.id
       ORDER BY CASE g.type WHEN 'income' THEN 1 WHEN 'expense' THEN 2 ELSE 3 END,g.sort_order,lower(g.name),c.sort_order,lower(c.name)`,
    )
  ).rows;
  return {
    groups: groups.map((g: any) => ({ ...g, id: Number(g.id) })),
    categories: categories.map((c: any) => ({
      ...c,
      id: Number(c.id),
      group_id: Number(c.group_id),
    })),
  };
}

async function groupName(id: number) {
  const row = (await pool.query('SELECT name FROM category_groups WHERE id=$1', [id])).rows[0];
  if (!row) throw new Error('Unknown group');
  return row.name as string;
}

export async function createCategory(body: unknown) {
  const b = ensure(createCategoryBody, body, 'Enter a category name of up to 60 characters');
  const group = await groupName(b.group_id);
  try {
    const row = (
      await pool.query(
        `INSERT INTO categories(name,group_name,group_id,emoji,sort_order)
         VALUES($1,$2,$3,$4,(SELECT coalesce(max(sort_order),0)+1 FROM categories WHERE group_id=$3)) RETURNING id`,
        [b.name, group, b.group_id, b.emoji ?? ''],
      )
    ).rows[0];
    return { id: Number(row.id) };
  } catch (e) {
    return duplicate('category', e);
  }
}

export async function updateCategory(id: number, body: unknown) {
  const b = ensure(updateCategoryBody, body, 'Enter a category name of up to 60 characters');
  const sets: string[] = [];
  const params: any[] = [id];
  const set = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column}=$${params.length}`);
  };
  if (b.name !== undefined) set('name', b.name);
  if (b.emoji !== undefined) set('emoji', b.emoji);
  if (b.group_id !== undefined) {
    const group = await groupName(b.group_id);
    set('group_id', b.group_id);
    set('group_name', group);
  }
  try {
    const r = await pool.query(`UPDATE categories SET ${sets.join(',')} WHERE id=$1`, params);
    if (!r.rowCount) throw notFound('Category');
  } catch (e) {
    return duplicate('category', e);
  }
  return { ok: true };
}

export async function deleteCategory(id: number) {
  const row = (await pool.query('SELECT key FROM categories WHERE id=$1', [id])).rows[0];
  if (!row) throw notFound('Category');
  if (row.key === 'uncategorized')
    throw new Error('Uncategorized is the fallback and cannot be deleted');
  const used = (await pool.query('SELECT count(*)::int AS n FROM rules WHERE category_id=$1', [id]))
    .rows[0].n;
  if (used)
    throw new Error(
      `${used === 1 ? 'A rule uses' : used + ' rules use'} this category: change or delete ${used === 1 ? 'it' : 'them'} first`,
    );
  await pool.query('DELETE FROM categories WHERE id=$1', [id]);
  return { ok: true };
}

export async function createGroup(body: unknown) {
  const b = ensure(createGroupBody, body, 'Enter a group name of up to 40 characters');
  try {
    const row = (
      await pool.query(
        `INSERT INTO category_groups(type,name,sort_order)
         VALUES($1,$2,(SELECT coalesce(max(sort_order),0)+10 FROM category_groups WHERE type=$1)) RETURNING id`,
        [b.type, b.name],
      )
    ).rows[0];
    return { id: Number(row.id) };
  } catch (e) {
    return duplicate('group', e);
  }
}

export async function updateGroup(id: number, body: unknown) {
  const b = ensure(updateGroupBody, body, 'Enter a group name of up to 40 characters');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('UPDATE category_groups SET name=$2 WHERE id=$1', [id, b.name]);
    if (!r.rowCount) throw notFound('Group');
    await client.query('UPDATE categories SET group_name=$2 WHERE group_id=$1', [id, b.name]);
    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK');
    return duplicate('group', e);
  } finally {
    client.release();
  }
}

/** Only an empty group can be deleted; move or delete its categories first. */
export async function deleteGroup(id: number) {
  const group = (await pool.query('SELECT 1 FROM category_groups WHERE id=$1', [id])).rowCount;
  if (!group) throw notFound('Group');
  const used = (await pool.query('SELECT 1 FROM categories WHERE group_id=$1 LIMIT 1', [id]))
    .rowCount;
  if (used) throw new Error('Move or delete the categories in this group first');
  await pool.query('DELETE FROM category_groups WHERE id=$1', [id]);
  return { ok: true };
}
