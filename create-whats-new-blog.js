// One-off provisioning script (like setup-area-channels.js / setup-webhook.js) — safe to re-run,
// checks for an existing blog with this title before creating a new one.
const fs = require('node:fs');
const path = require('node:path');
const { shopifyQuery, shopifyMutate } = require('./lib');

const BLOG_TITLE = "What's New";

async function main() {
  const findFile = path.join(__dirname, '_tmp-find-blog.graphql');
  fs.writeFileSync(findFile, `query { blogs(first: 20) { edges { node { id title handle } } } }`);
  const existing = await shopifyQuery(findFile);
  fs.unlinkSync(findFile);

  const found = existing.blogs.edges.find((e) => e.node.title === BLOG_TITLE);
  if (found) {
    console.log(`Blog already exists: ${found.node.id} (handle: ${found.node.handle})`);
    return;
  }

  const createFile = path.join(__dirname, '_tmp-create-blog.graphql');
  fs.writeFileSync(
    createFile,
    `mutation CreateBlog($title: String!) { blogCreate(blog: {title: $title}) { blog { id title handle } userErrors { field message } } }`
  );
  const result = await shopifyMutate(createFile, { title: BLOG_TITLE });
  fs.unlinkSync(createFile);

  if (result.blogCreate.userErrors.length) {
    console.error('Failed:', JSON.stringify(result.blogCreate.userErrors));
    process.exit(1);
  }
  console.log(`Created blog: ${result.blogCreate.blog.id} (handle: ${result.blogCreate.blog.handle})`);
}

main();
