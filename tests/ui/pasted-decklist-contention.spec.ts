import { test, expect } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
function db(body: string): any { return JSON.parse(execFileSync('docker', ['exec', '-i', 'mtg-archives-web-1', 'node'], { input: "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{" + body + "})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.code||'Owned commander fixture error');process.exitCode=1}).finally(()=>p.$disconnect());", encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 })); }
for (const scenario of [{ name: 'slow', seconds: 7, concurrent: false }, { name: 'concurrent', seconds: 1, concurrent: true }])
    test('physical commander import preserves rows through ' + scenario.name + ' contention', async ({ page, baseURL }, testInfo) => {
        test.skip(process.env.MTG_LOCAL_PILOT_TEST !== '1', 'Owned local Docker fixture');
        expect(baseURL).toBe('http://127.0.0.1:13001');
        const dir = testInfo.outputPath('evidence');
        mkdirSync(dir, { recursive: true });
        test.setTimeout(240000);
        const n = 'ui-deck-scale-' + randomUUID(), password = randomUUID(), outcomes: any[] = [];
        const errors: unknown[] = [];
        let release: Promise<void> | undefined;
        writeFileSync(dir + '/owner-journal.json', JSON.stringify({ owner: n, runId: randomUUID(), createdAt: new Date().toISOString() }));
        let failed: unknown;
        try {
            const fixture = db("const n=" + JSON.stringify(n) + ";await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:await require('bcryptjs').hash(" + JSON.stringify(password) + ",10)}});const commander=await p.card.findFirstOrThrow({where:{lang:'en',digital:false,typeLine:{contains:'Legendary Creature'},name:{not:{startsWith:'A-'}}},orderBy:{name:'asc'}});const rows=await p.card.findMany({where:{lang:'en',digital:false},distinct:['name'],take:500,orderBy:{name:'asc'},select:{id:true,name:true,setCode:true,collectorNumber:true}});const chosen=rows.filter(c=>c.name!==commander.name&&/^[A-Za-z][A-Za-z0-9 ,'.!-]+$/.test(c.name)&&/^[A-Za-z0-9-]+$/.test(c.collectorNumber)).slice(0,99);if(chosen.length!==99)throw Error('Insufficient representative cards');const cards=[commander,...chosen];const make=name=>p.deck.create({data:{ownerUserId:n,name,format:'COMMANDER',visibility:'PRIVATE'}});const control=await make(n+' list'),physical=await make(n+' physical');return {control:control.id,physical:physical.id,text:'Commander\\n1 '+commander.name+' ('+commander.setCode+') '+commander.collectorNumber+'\\nDeck\\n'+chosen.map(c=>'1 '+c.name+' ('+c.setCode+') '+c.collectorNumber).join('\\n'),ids:cards.map(c=>c.id)};");
            await page.goto('/login');
            await page.getByLabel(/username or email/i).fill(n);
            await page.getByLabel(/^password$/i).fill(password);
            await page.getByRole('button', { name: /^log in$/i }).click();
            await page.waitForURL(/dashboard/);
            for (const physical of [true]) {
                const deckId = physical ? fixture.physical : fixture.control;
                await page.goto('/decks/' + deckId + '/import');
                await page.getByLabel('Decklist text', { exact: true }).fill(fixture.text.replaceAll('\\n', '\n'));
                const parseStart = Date.now();
                await page.getByRole('button', { name: 'Parse and review' }).click();
                const copies = page.getByLabel('Create and commit inventory', { exact: true });
                await expect(copies).toHaveCount(100, { timeout: 90000 });
                await expect(copies.first()).toBeEnabled({ timeout: 90000 });
                if (physical)
                    for (let i = 0; i < 100; i++)
                        await copies.nth(i).check();
                const form = page.locator('form').filter({ has: page.locator('input[name="linesJson"]') });
                const payload = JSON.parse(await form.locator('input[name="linesJson"]').inputValue());
                expect(payload).toHaveLength(100);
                expect(payload.filter((l: any) => l.physicalQuantity > 0)).toHaveLength(physical ? 100 : 0);
                const parseAndReviewMs = Date.now() - parseStart;
                const seed = db("const d=await p.deck.findUniqueOrThrow({where:{id:" + JSON.stringify(deckId) + "}});const c=await p.card.findUniqueOrThrow({where:{id:" + JSON.stringify(fixture.ids[0]) + "}});const row=await p.deckCard.create({data:{deckId:d.id,cardId:c.id,scryfallId:c.scryfallId,oracleId:c.oracleId,cardName:c.name,section:'COMMANDER',quantity:1,isCommander:true}});return {id:row.id};");
                const child = spawn('docker', ['exec', '-i', 'mtg-archives-web-1', 'node'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
                let readyBuffer = '';
                release = new Promise<void>((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error('Owned row-lock process failed'))); });
                release.catch(() => {});
                const ready = new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Owned row-lock readiness timeout')), 10000); child.stdout.on('data', chunk => { readyBuffer += chunk.toString(); if (readyBuffer.includes('OWNED_LOCK_READY')) {
                    clearTimeout(timer);
                    resolve();
                } }); child.on('exit', code => { if (!readyBuffer.includes('OWNED_LOCK_READY')) {
                    clearTimeout(timer);
                    reject(new Error('Owned row-lock exited before readiness'));
                } }); });
                async function holdOwnedRow(id: string, seconds: number, concurrent: boolean) { const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); try {
                    await p.$transaction(async (tx: any) => { await tx.$queryRawUnsafe('SELECT id FROM "DeckCard" WHERE id=$1 FOR UPDATE', id); console.log('OWNED_LOCK_READY'); await tx.$queryRawUnsafe('SELECT pg_sleep($1::double precision)::text', seconds); if (concurrent)
                        await tx.deckCard.update({ where: { id }, data: { quantity: { increment: 1 } } }); }, { timeout: 15000 });
                }
                finally {
                    await p.$disconnect();
                } }
                child.stdin.end('(' + holdOwnedRow.toString() + ')(' + JSON.stringify(seed.id) + ',' + scenario.seconds + ',' + scenario.concurrent + ').catch(()=>{process.exitCode=1})');
                await ready;
                const reply = page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes('/decks/'), { timeout: 90000 });
                const start = Date.now();
                await form.getByRole('button').click();
                const response = await reply;
                await page.waitForTimeout(500);
                const result = db("const n=" + JSON.stringify(n) + ",deckId=" + JSON.stringify(deckId) + ";return {deck:(await p.deckCard.aggregate({where:{deckId},_sum:{quantity:true}}))._sum.quantity||0,stock:(await p.inventoryItem.aggregate({where:{currentOwnerId:n},_sum:{quantity:true}}))._sum.quantity||0,audits:await p.inventoryAuditLog.count({where:{changedByUserId:n}}),locations:await p.inventoryLocation.count({where:{ownerPlayerId:n}})};");
                const outcome = { physical, status: response.status(), commitMs: Date.now() - start, parseAndReviewMs, lines: payload.length, result, url: page.url(), text: (await page.locator('body').innerText()).slice(-2000) };
                outcomes.push(outcome);
                writeFileSync(dir + '/request-outcomes-private.json', JSON.stringify(outcomes, null, 2));
                expect(outcome.status).toBeLessThan(400);
                expect(result.deck).toBe(scenario.concurrent ? 102 : 101);
                expect(result.stock).toBe(physical ? 100 : 0);
                expect(result.audits).toBe(physical ? 200 : 0);
            }
        }
        catch (e) {
            failed = e;
            errors.push(e);
        }
        finally {
            try {
                if (release)
                    await release;
            }
            catch (e) {
                errors.push(e);
            }
            try {
                const cleanup = db("const n=" + JSON.stringify(n) + ";if(!/^ui-deck-scale-[a-f0-9-]{36}$/.test(n))throw Error('Invalid owner');await p.inventoryAuditLog.deleteMany({where:{changedByUserId:n}});await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.deck.deleteMany({where:{ownerUserId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});return {clean:true,owner:n};");
                writeFileSync(dir + '/cleanup.json', JSON.stringify(cleanup));
            }
            catch (e) {
                errors.push(e);
            }
            writeFileSync(dir + '/outcome.json', JSON.stringify({ kind: 'Owned PostgreSQL contention control; actual reporter incident cause unconfirmed', scenario: scenario.name, outcomes: outcomes.map(({ text, url, ...r }) => r), failure: failed instanceof Error ? failed.message.slice(0, 400) : !!failed, cleanupFailures: errors.length - (failed ? 1 : 0) }, null, 2));
            if (errors.length === 1)
                throw errors[0];
            if (errors.length > 1)
                throw new AggregateError(errors, 'Representative import/cleanup failures retained');
        }
    });
