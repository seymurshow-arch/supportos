import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOTION_API_VERSION = "2022-06-28";

type NotionRichText = {
  plain_text?: string;
};

type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: any;
};

type KnowledgePage = {
  id: string;
  title: string;
  text: string;
  children: KnowledgePage[];
};

function getEnv() {
  const token = process.env.NOTION_API_TOKEN?.trim();
  const rootPageId = process.env.NOTION_SUPPORT_ROOT_PAGE_ID?.trim();

  if (!token) {
    throw new Error("NOTION_API_TOKEN is missing");
  }

  if (!rootPageId) {
    throw new Error("NOTION_SUPPORT_ROOT_PAGE_ID is missing");
  }

  return {
    token,
    rootPageId,
  };
}

async function notionFetch(path: string) {
  const { token } = getEnv();

  const response = await fetch(`https://api.notion.com/v1${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_API_VERSION,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Notion API error ${response.status}: ${text.slice(0, 500)}`
    );
  }

  return JSON.parse(text);
}

function richTextToPlainText(items: NotionRichText[] | undefined) {
  if (!Array.isArray(items)) return "";

  return items
    .map((item) => item?.plain_text || "")
    .join("")
    .trim();
}

function extractBlockText(block: NotionBlock) {
  const data = block?.[block.type];

  if (!data) return "";

  if (Array.isArray(data.rich_text)) {
    return richTextToPlainText(data.rich_text);
  }

  if (block.type === "child_page") {
    return String(data.title || "").trim();
  }

  return "";
}

async function getPageTitle(pageId: string) {
  const page = await notionFetch(`/pages/${pageId}`);

  const properties = page?.properties || {};

  for (const property of Object.values(properties) as any[]) {
    if (property?.type === "title") {
      const title = richTextToPlainText(property.title);

      if (title) {
        return title;
      }
    }
  }

  return pageId;
}

async function getAllBlockChildren(blockId: string) {
  const results: NotionBlock[] = [];

  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({
      page_size: "100",
    });

    if (cursor) {
      params.set("start_cursor", cursor);
    }

    const data = await notionFetch(
      `/blocks/${blockId}/children?${params.toString()}`
    );

    if (Array.isArray(data?.results)) {
      results.push(...data.results);
    }

    cursor =
      data?.has_more && data?.next_cursor
        ? String(data.next_cursor)
        : undefined;
  } while (cursor);

  return results;
}

/**
 * Рекурсивно проходить через БУДЬ-ЯКІ блоки:
 *
 * column_list
 *   → column
 *     → child_page
 *       → blocks
 *
 * а також toggles, synced blocks, списки і т.д.
 */
async function readNestedBlocks(
  blockId: string,
  visitedPages: Set<string>,
  depth: number
): Promise<{
  textParts: string[];
  childPages: KnowledgePage[];
}> {
  const textParts: string[] = [];
  const childPages: KnowledgePage[] = [];

  if (depth > 15) {
    return {
      textParts,
      childPages,
    };
  }

  const blocks = await getAllBlockChildren(blockId);

  for (const block of blocks) {
    const text = extractBlockText(block);

    if (text && block.type !== "child_page") {
      textParts.push(text);
    }

    /**
     * Окрема дочірня Notion page.
     */
    if (block.type === "child_page") {
      const childPage = await readPageRecursive(
        block.id,
        visitedPages,
        depth + 1
      );

      childPages.push(childPage);

      continue;
    }

    /**
     * Головний fix:
     *
     * якщо блок має children,
     * йдемо ВСЕРЕДИНУ незалежно від його type.
     *
     * Саме це дозволяє пройти:
     *
     * column_list
     * → column
     * → child_page
     */
    if (block.has_children) {
      const nested = await readNestedBlocks(
        block.id,
        visitedPages,
        depth + 1
      );

      textParts.push(...nested.textParts);
      childPages.push(...nested.childPages);
    }
  }

  return {
    textParts,
    childPages,
  };
}

async function readPageRecursive(
  pageId: string,
  visitedPages = new Set<string>(),
  depth = 0
): Promise<KnowledgePage> {
  if (visitedPages.has(pageId)) {
    return {
      id: pageId,
      title: "Already visited",
      text: "",
      children: [],
    };
  }

  if (depth > 15) {
    return {
      id: pageId,
      title: "Depth limit reached",
      text: "",
      children: [],
    };
  }

  visitedPages.add(pageId);

  const title = await getPageTitle(pageId);

  const nested = await readNestedBlocks(
    pageId,
    visitedPages,
    depth
  );

  return {
    id: pageId,
    title,
    text: nested.textParts.join("\n").trim(),
    children: nested.childPages,
  };
}

function flattenPages(page: KnowledgePage) {
  const result: Array<{
    id: string;
    title: string;
    textLength: number;
    preview: string;
  }> = [];

  function walk(node: KnowledgePage) {
    result.push({
      id: node.id,
      title: node.title,
      textLength: node.text.length,
      preview: node.text.slice(0, 500),
    });

    node.children.forEach(walk);
  }

  walk(page);

  return result;
}

export async function GET() {
  try {
    const { rootPageId } = getEnv();

    const rootBlocks = await getAllBlockChildren(rootPageId);

    const knowledge = await readPageRecursive(rootPageId);

    const pages = flattenPages(knowledge);

    return NextResponse.json({
      ok: true,

      rootPageId,

      totalPages: pages.length,

      pages,

      tree: knowledge,

      debugRootBlocks: rootBlocks.map((block) => ({
        id: block.id,
        type: block.type,
        has_children: block.has_children,
        data: block[block.type],
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Unknown Notion knowledge error",
      },
      {
        status: 500,
      }
    );
  }
}