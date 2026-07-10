/* ============================================================================
 * EMBERFELL - data/dialogue.js  (Quests & NPCs dept, Cycle 3)
 * Pure data. The dialogue RUNNER lives in npcs.js; this file is only lines.
 *
 * Voice note: rural, weathered, a little dry. Two to three sentences a node,
 * because it is read on a phone. ASCII quotes only (SS2.5) - apostrophes are
 * plain U+0027, never smart quotes.
 *
 * ---- SCHEMA (read by npcs.js runner) --------------------------------------
 * EF.dialogue.npc[npcId] = {
 *   name     : display name shown as the speaker.
 *   branches : ordered list. The runner asks EF.quests.getState(quest) and
 *              opens the FIRST branch whose quest is in the named state.
 *              states: 'offerable' | 'active' | 'ready' | 'done' | 'locked'.
 *   fallback : node id opened when no branch matches (idle chatter).
 *   nodes    : { nodeId: { text, choices:[choice] } }
 *     choice = { label, action, ... }
 *       action:'accept', quest:<id>   -> EF.quests.accept + track
 *       action:'turnIn', quest:<id>   -> EF.quests.turnIn(quest, thisNpc)
 *       action:'goto',   node:<id>    -> walk to another node (gossip)
 *       action:'close'                -> emit dialogue:close
 * -------------------------------------------------------------------------- */
(function () {
  'use strict';
  var EF = (window.EF = window.EF || {});

  EF.dialogue = {
    npc: {

      /* ---- MAREN - village elder by the fire. Dry, unsurprised. ------- */
      maren: {
        name: 'Maren',
        branches: [
          { quest: 'maren.wolves', state: 'ready',     node: 'wolves_turnin' },
          { quest: 'maren.watch',  state: 'ready',     node: 'watch_turnin' },
          { quest: 'talia.delivery', state: 'active',  node: 'delivery_recv' },
          { quest: 'maren.wolves', state: 'active',    node: 'wolves_active' },
          { quest: 'maren.watch',  state: 'active',    node: 'watch_active' },
          { quest: 'maren.seal',   state: 'active',    node: 'seal_active' },
          { quest: 'maren.wolves', state: 'offerable', node: 'wolves_offer' },
          { quest: 'maren.watch',  state: 'offerable', node: 'watch_offer' },
          { quest: 'maren.seal',   state: 'offerable', node: 'seal_offer' },
          { quest: 'maren.seal',   state: 'done',      node: 'seal_done' }
        ],
        fallback: 'greet',
        nodes: {
          greet: {
            text: 'Emberfell still stands, traveler, which is more than some seasons can say. Warm your hands if you like; the fire asks nothing of anyone.',
            choices: [ { label: 'Farewell', action: 'close' } ]
          },
          wolves_offer: {
            text: 'Wolves have grown bold this autumn - took two of my goats in a week. Put down five of them out in the pines and I will see you paid in good gold.',
            choices: [
              { label: 'I will thin them', action: 'accept', quest: 'maren.wolves' },
              { label: 'Later', action: 'close' }
            ]
          },
          wolves_active: {
            text: 'The pines still echo, by my old ears. Come back to me when the pack is five lighter.',
            choices: [ { label: 'Soon', action: 'close' } ]
          },
          wolves_turnin: {
            text: 'Five pelts. The little ones will sleep without something listening at the door. Here - a hundred gold, and my thanks piled on top.',
            choices: [ { label: 'Gladly', action: 'turnIn', quest: 'maren.wolves' } ]
          },
          watch_offer: {
            text: 'Now there is worse than wolves. Something has stirred the bones along the tower road - three of them, up and walking. Lay them down again before some fool wanders up there.',
            choices: [
              { label: 'I will see to it', action: 'accept', quest: 'maren.watch' },
              { label: 'Not yet', action: 'close' }
            ]
          },
          watch_active: {
            text: 'Bones do not tire the way we do. Three of them still upright, last a shepherd told me.',
            choices: [ { label: 'On my way', action: 'close' } ]
          },
          watch_turnin: {
            text: 'The road is quiet again. You have a strong stomach, I will give you that much. Take this for the trouble.',
            choices: [ { label: 'Thank you', action: 'turnIn', quest: 'maren.watch' } ]
          },
          seal_offer: {
            text: 'The road is quiet, so I will say the thing I have been chewing on. That tower has been sealed since my grandmother was a girl, and lately the runes run warm to the touch. Go stand at its door - just look, mind, nothing more.',
            choices: [
              { label: 'I will look', action: 'accept', quest: 'maren.seal' },
              { label: 'That sounds unwise', action: 'close' }
            ]
          },
          seal_active: {
            text: 'Go on up to the tower, then. Stand at the door and come tell me what it is you feel.',
            choices: [ { label: 'I will', action: 'close' } ]
          },
          seal_done: {
            text: 'So it is open. I felt the cold of it from here, down in my knees. Whatever waited in there has been waiting a long while for a door.',
            choices: [ { label: 'Farewell', action: 'close' } ]
          },
          delivery_recv: {
            text: 'Talia sent you? And a ring, no less - I knew her mother, years gone. Put it here. Tell her... no. I will tell her myself, come spring. Here, for your boots.',
            choices: [ { label: 'Give Maren the ring', action: 'turnIn', quest: 'talia.delivery' } ]
          }
        }
      },

      /* ---- ODDA - herbalist by the well. Brisk, practical. ------------ */
      odda: {
        name: 'Odda',
        branches: [
          { quest: 'odda.herbs', state: 'ready',     node: 'herbs_turnin' },
          { quest: 'odda.herbs', state: 'active',    node: 'herbs_active' },
          { quest: 'odda.herbs', state: 'offerable', node: 'herbs_offer' },
          { quest: 'odda.herbs', state: 'done',      node: 'herbs_done' }
        ],
        fallback: 'greet',
        nodes: {
          greet: {
            text: 'Mind the mud by the well - it has swallowed better boots than yours. You after a remedy, or just wasting good daylight?',
            choices: [ { label: 'Just passing', action: 'close' } ]
          },
          herbs_offer: {
            text: 'I am short on marsh-herb and half the village has the wet cough. Three good ones grow by the Stillmere shore - they glow, you cannot miss them. Bring them and I will not charge you all winter.',
            choices: [
              { label: 'I will gather them', action: 'accept', quest: 'odda.herbs' },
              { label: 'Maybe later', action: 'close' }
            ]
          },
          herbs_active: {
            text: 'Three herbs, down by the lake, the ones that glow. Leave the dull ones be - those are just weed putting on airs.',
            choices: [ { label: 'Understood', action: 'close' } ]
          },
          herbs_turnin: {
            text: 'There they are, still warm in the hand. That is the cough handled, then. Take this - and do not go chewing them raw, whatever the old wives tell you.',
            choices: [ { label: 'Payment enough', action: 'turnIn', quest: 'odda.herbs' } ]
          },
          herbs_done: {
            text: 'Cough is easing already, half the street breathing quiet. You did a good turn, even if you tracked mud through my door doing it.',
            choices: [ { label: 'Farewell', action: 'close' } ]
          }
        }
      },

      /* ---- GETHIN - old watchman. Terse, uneasy. ---------------------- */
      gethin: {
        name: 'Gethin',
        branches: [
          { quest: 'gethin.stones', state: 'ready',     node: 'stones_turnin' },
          { quest: 'gethin.stones', state: 'active',    node: 'stones_active' },
          { quest: 'gethin.stones', state: 'offerable', node: 'stones_offer' },
          { quest: 'gethin.stones', state: 'done',      node: 'stones_done' }
        ],
        fallback: 'greet',
        nodes: {
          greet: {
            text: 'Eyes open out there, traveler. This valley is quieter than it has any right to be, and quiet has got teeth in my experience.',
            choices: [ { label: 'I will watch myself', action: 'close' } ]
          },
          stones_offer: {
            text: 'You will think me old and daft, but the standing stones have been humming since the last frost. I cannot leave my post to look. Walk out there, would you, and come back and tell me it is nothing.',
            choices: [
              { label: 'I will go and see', action: 'accept', quest: 'gethin.stones' },
              { label: 'Some other day', action: 'close' }
            ]
          },
          stones_active: {
            text: 'The stones sit west of here, past the tree line. Just go and stand among them a breath or two. That is all I ask.',
            choices: [ { label: 'Heading there', action: 'close' } ]
          },
          stones_turnin: {
            text: 'Well? You felt it too - I can see it sitting on you. I will not sleep any easier, but at least I know I am not mad. Here, for the walk.',
            choices: [ { label: 'Take care, Gethin', action: 'turnIn', quest: 'gethin.stones' } ]
          },
          stones_done: {
            text: 'Whatever hums in those stones, it has not stopped. But a shared worry weighs half as much. My thanks again.',
            choices: [ { label: 'Farewell', action: 'close' } ]
          }
        }
      },

      /* ---- TALIA - a traveler resting at the ruined arch. ------------- */
      talia: {
        name: 'Talia',
        branches: [
          { quest: 'talia.delivery', state: 'active',    node: 'delivery_active' },
          { quest: 'talia.delivery', state: 'offerable', node: 'delivery_offer' },
          { quest: 'talia.delivery', state: 'done',      node: 'delivery_done' }
        ],
        fallback: 'greet',
        nodes: {
          greet: {
            text: 'Do not mind me - just resting my feet under a broken arch like a fool with nowhere better. The road does that to a person.',
            choices: [ { label: 'Safe travels', action: 'close' } ]
          },
          delivery_offer: {
            text: 'You are headed to the village? Do a stranger one kindness. This ring was my mother\'s, and Maren knew her once. I cannot make myself walk in there and say it, so let the ring say it for me.',
            choices: [
              { label: 'I will carry it', action: 'accept', quest: 'talia.delivery' },
              { label: 'I cannot, sorry', action: 'close' }
            ]
          },
          delivery_active: {
            text: 'Maren keeps by the fire, in the heart of the village. Just set the ring in her hand - she will understand the rest without me spelling it.',
            choices: [ { label: 'It is as good as done', action: 'close' } ]
          },
          delivery_done: {
            text: 'You gave it to her, then. Thank you for that. The road sits lighter with one old thing finally set down.',
            choices: [ { label: 'Farewell', action: 'close' } ]
          }
        }
      },

      /* ---- CORIN - pure flavour. Loiters by the well, all tongue. ----- */
      corin: {
        name: 'Corin',
        branches: [],
        fallback: 'greet',
        nodes: {
          greet: {
            text: 'Now you look like someone with time to waste. Good - I have got tongue enough for two and no one left willing to lend an ear.',
            choices: [
              { label: 'Any news?', action: 'goto', node: 'g1' },
              { label: 'Not today', action: 'close' }
            ]
          },
          g1: {
            text: 'They say that tower is older than the valley - here before the first Emberfell drove a fence post. Old Maren will not speak of it, and that woman will speak of anything.',
            choices: [
              { label: 'Go on', action: 'goto', node: 'g2' },
              { label: 'Enough', action: 'close' }
            ]
          },
          g2: {
            text: 'Gethin swears the stones sing. Me, I say he has been on watch so long he started harmonising with his own two ears.',
            choices: [
              { label: 'And Odda?', action: 'goto', node: 'g3' },
              { label: 'Enough', action: 'close' }
            ]
          },
          g3: {
            text: 'Odda? Do not take her tonics on an empty stomach, is all a friend will tell you. I learned that lesson twice, being a slow study.',
            choices: [
              { label: 'Start again', action: 'goto', node: 'g1' },
              { label: 'Enough gossip', action: 'close' }
            ]
          }
        }
      }

    }
  };
})();
