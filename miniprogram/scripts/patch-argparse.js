/* eslint-disable no-console */
const fs = require('fs')
const path = require('path')

const targetFile = path.join(__dirname, '..', 'node_modules', 'argparse', 'argparse.js')

function patchArgparseSyntax() {
  if (!fs.existsSync(targetFile)) {
    console.log('[patch-argparse] skip: argparse.js not found')
    return
  }

  const source = fs.readFileSync(targetFile, 'utf8')
  if (source.includes('} catch (e) {}')) {
    console.log('[patch-argparse] already patched')
    return
  }

  const patched = source.replace(/}\s*catch\s*{\s*}/g, '} catch (e) {}')
  if (patched === source) {
    console.log('[patch-argparse] no target pattern found')
    return
  }

  fs.writeFileSync(targetFile, patched, 'utf8')
  console.log('[patch-argparse] patched argparse.js for WeChat parser compatibility')
}

patchArgparseSyntax()
