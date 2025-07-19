import { router } from '../router';
import { Env } from '../[[path]]'
import { json } from 'itty-router-extras';
import StatusCode, { Ok, Fail, Build, ImgItem, ImgList, ImgReq, Folder, AuthToken, FailCode, NotAuth } from "../type";
import { checkFileType, getFileName, parseRange } from '../utils'
import { R2ListOptions } from "@cloudflare/workers-types";

const auth = async (request : Request, env : Env) => {
    const method = request.method;
    // console.log(method)
    if (method == "GET" || method == "OPTIONS") {
        return
    }
    // get user token
    const token = request.headers.get('Authorization')
    if (!token) {
        return json(NotAuth())
    }
    // with kv equal
    const authKey = await env.XK.get('PICX_AUTH_TOKEN')
    if (!authKey) {
        return json(Fail("system not auth setting"))
    }
    if (authKey != token) {
        return json(FailCode("auth fail", StatusCode.NotAuth))
    }
    // return new Response('Not Authenticated', { status: 401 })
}

// 检测token是否有效
router.post('/checkToken', async (req : Request, env : Env) => {
    const data = await req.json() as AuthToken
    const token = data.token
    if (!token) {
        return json(Ok(false))
    }
    const authKey = await env.XK.get('PICX_AUTH_TOKEN')
    if (!authKey) {
        return json(Ok(false))
    }
    if (authKey != token) {
        return json(Ok(false))
    }
    return json(Ok(true))
})

// list image by path
router.get('/list/:folder*', auth, async (req : Request, env : Env) => {
    const { params } = req
    const url = new URL(req.url)

    let prefix = params.folder
    const limit = Number(url.searchParams.get('limit')) || 100
    const cursor = url.searchParams.get('cursor') || undefined

    const options: R2ListOptions = {
        limit: Math.min(limit, 100),
        cursor,
        delimiter: '/',
    }
    if (prefix) {
        options.prefix = prefix.endsWith('/') ? prefix : `${prefix}/`
    }

    const list = await env.PICX.list(options)
    const truncated = list.truncated ?? false
    const newCursor = list.cursor
    const objs = list.objects
    const urls = objs.map(it => ({
        url: `${env.BASE_URL}/rest/${it.key}`,
        key: it.key,
        size: it.size,
    }))

    return json(Ok(<ImgList>{
        list: urls,
        next: truncated,
        cursor: newCursor,
        prefixes: list.delimitedPrefixes,
    }))
})

// batch upload file
router.post('/upload',  auth, async (req: Request, env : Env) => {
    const files = await req.formData()
    const images = files.getAll("files")
    const prefix = files.get("prefix") as string
    const errs = []
    const urls = Array<ImgItem>()
    for (let item of images) {
        const fileType = item.type
        if (!checkFileType(fileType)) {
            errs.push(`${fileType} not support.`)
            continue
        }
        const time = new Date().getTime()
        let filename = await getFileName(fileType, time)
        if (prefix) {
            filename = `${prefix}${filename}`
        }
        const header = new Headers()
        header.set("content-type", fileType)
        header.set("content-length", `${item.size}`)
        const object = await env.PICX.put(filename, item.stream(), {
            httpMetadata: header,
        }) as R2Object
        if (object || object.key) {
            urls.push({
                key: object.key,
                size: object.size,
                url: `${env.BASE_URL}/rest/${object.key}`,
                filename: item.name
            })
        }
    }
    return json(Build(urls, errs.toString()))
})

// 创建目录
router.post("/folder",  auth, async (req: Request, env: Env) => {
    try {
        const data = await req.json() as Folder
        const regx = /^[A-Za-z0-9_]+$/
        if (!regx.test(data.name)) {
            return json(Fail("Folder name error"))
        }
        await env.PICX.put(data.name + '/', null)
        return json(Ok("Success"))
    } catch (e) {
        return json(Fail("Create folder fail"))
    }
})

// 删除key
router.get('/del/:id+', async (req : Request, env: Env) => {
    const key = req.params.id
    if (!key) {
        return json(Fail("not delete key"))
    }
    try {
        await env.PICX.delete(key)
    } catch (e) {
        console.log(`img delete error:${e.message}`,)
    }
    return json(Ok(key))
})

// delete image
router.delete("/",  auth, async (req : Request, env: Env) => {
    const params = await req.json()
    // console.log(params)
    const keys = params.keys;
    if (!keys || keys.length < 1) {
        return json(Fail("not delete keys"))
    }
    const arr = keys.split(',')
    try {
        for (let it of arr) {
            if(it && it.length) {
                await env.PICX.delete(it)
            }
        }
    } catch (e) {
        console.log(`img delete error:${e.message}`,)
    }
    return json(Ok(keys))
})

// image detail
router.get("/:id+", async (req : Request, env : Env) => {
    let id = req.params.id
    const range = parseRange(req.headers.get('range'))
    const object = await env.PICX.get(id, {
        range,
        onlyIf: req.headers,
    })
    if (object == null) {
        return json(Fail("object not found"))
    }
    const headers = new Headers()
    object.writeHttpMetadata(headers)
    headers.set('etag', object.httpEtag)
    if (range) {
        headers.set("content-range", `bytes ${range.offset}-${range.end}/${object.size}`)
    }
    const status = object.body ? (range ? 206 : 200) : 304
    return new Response(object.body, {
        headers,
        status
    })
})
