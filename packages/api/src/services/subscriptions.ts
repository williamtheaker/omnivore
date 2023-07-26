import axios from 'axios'
import { NewsletterEmail } from '../entity/newsletter_email'
import { Subscription } from '../entity/subscription'
import { getRepository } from '../entity/utils'
import { SubscriptionStatus, SubscriptionType } from '../generated/graphql'
import { buildLogger } from '../utils/logger'
import { sendEmail } from '../utils/sendEmail'
import { createNewsletterEmail } from './newsletters'

const logger = buildLogger('app.dispatch')

interface SaveSubscriptionInput {
  userId: string
  name: string
  newsletterEmail: NewsletterEmail
  unsubscribeMailTo?: string
  unsubscribeHttpUrl?: string
  icon?: string
  from?: string
}

export const UNSUBSCRIBE_EMAIL_TEXT =
  'This message was automatically generated by Omnivore.'

export const parseUnsubscribeMailTo = (unsubscribeMailTo: string) => {
  const parsed = new URL(`mailto://${unsubscribeMailTo}`)
  const subject = parsed.searchParams.get('subject') || 'Unsubscribe'
  const to = unsubscribeMailTo.replace(parsed.search, '')

  // validate email address
  if (!to || !to.includes('@')) {
    throw new Error(`Invalid unsubscribe email address: ${unsubscribeMailTo}`)
  }

  return {
    to,
    subject,
  }
}

const sendUnsubscribeEmail = async (
  unsubscribeMailTo: string,
  newsletterEmail: string
): Promise<boolean> => {
  try {
    // get subject from unsubscribe email address if exists
    const parsed = parseUnsubscribeMailTo(unsubscribeMailTo)

    const sent = await sendEmail({
      to: parsed.to,
      subject: parsed.subject,
      text: UNSUBSCRIBE_EMAIL_TEXT,
      from: newsletterEmail,
    })

    if (!sent) {
      logger.info('Failed to send unsubscribe email', unsubscribeMailTo)
      return false
    }

    return true
  } catch (error) {
    logger.info('Failed to send unsubscribe email', error)
    return false
  }
}

const sendUnsubscribeHttpRequest = async (url: string): Promise<boolean> => {
  try {
    await axios.get(url, {
      timeout: 5000, // 5 seconds
    })

    return true
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.info('Failed to send unsubscribe http request', error.message)
    } else {
      logger.info('Failed to send unsubscribe http request', error)
    }
    return false
  }
}

export const getSubscriptionByNameAndUserId = async (
  name: string,
  userId: string
): Promise<Subscription | null> => {
  return getRepository(Subscription).findOneBy({
    name,
    user: { id: userId },
    type: SubscriptionType.Newsletter,
  })
}

export const saveSubscription = async ({
  userId,
  name,
  newsletterEmail,
  unsubscribeMailTo,
  unsubscribeHttpUrl,
  icon,
}: SaveSubscriptionInput): Promise<string> => {
  const subscriptionData = {
    unsubscribeHttpUrl,
    unsubscribeMailTo,
    icon,
    lastFetchedAt: new Date(),
  }

  const existingSubscription = await getSubscriptionByNameAndUserId(
    name,
    userId
  )
  if (existingSubscription) {
    // update subscription if already exists
    await getRepository(Subscription).update(
      existingSubscription.id,
      subscriptionData
    )

    return existingSubscription.id
  }

  const result = await getRepository(Subscription).save({
    ...subscriptionData,
    name,
    newsletterEmail: { id: newsletterEmail.id },
    user: { id: userId },
    type: SubscriptionType.Newsletter,
  })

  return result.id
}

export const unsubscribe = async (subscription: Subscription) => {
  // unsubscribe from newsletter
  if (subscription.type === SubscriptionType.Newsletter) {
    let unsubscribed = false

    if (subscription.unsubscribeMailTo && subscription.newsletterEmail) {
      // unsubscribe by sending email
      unsubscribed = await sendUnsubscribeEmail(
        subscription.unsubscribeMailTo,
        subscription.newsletterEmail.address
      )
    }
    // TODO: find a good way to unsubscribe by url if email fails or not provided
    // because it often requires clicking a button on the page to unsubscribe

    if (!unsubscribed) {
      // update subscription status to unsubscribed if failed to unsubscribe
      logger.info('Failed to unsubscribe', subscription.id)
      return getRepository(Subscription).update(subscription.id, {
        status: SubscriptionStatus.Unsubscribed,
      })
    }
  }

  // delete the subscription if successfully unsubscribed or it's an rss feed
  await getRepository(Subscription).delete(subscription.id)
}

export const unsubscribeAll = async (
  newsletterEmail: NewsletterEmail
): Promise<void> => {
  try {
    const subscriptions = await getRepository(Subscription).find({
      where: {
        user: { id: newsletterEmail.user.id },
        newsletterEmail: { id: newsletterEmail.id },
      },
      relations: ['newsletterEmail'],
    })

    for await (const subscription of subscriptions) {
      try {
        await unsubscribe(subscription)
      } catch (error) {
        logger.info('Failed to unsubscribe', error)
      }
    }
  } catch (error) {
    logger.info('Failed to unsubscribe all', error)
  }
}

export const getSubscribeHandler = (name: string): SubscribeHandler | null => {
  switch (name.toLowerCase()) {
    case 'axios_essentials':
      return new AxiosEssentialsHandler()
    case 'morning_brew':
      return new MorningBrewHandler()
    case 'milk_road':
      return new MilkRoadHandler()
    case 'money_stuff':
      return new MoneyStuffHandler()
    default:
      return null
  }
}

export class SubscribeHandler {
  async handleSubscribe(
    userId: string,
    name: string
  ): Promise<Subscription[] | null> {
    try {
      const newsletterEmail =
        (await getRepository(NewsletterEmail).findOneBy({
          user: { id: userId },
        })) || (await createNewsletterEmail(userId))

      // subscribe to newsletter service
      const subscribedNames = await this._subscribe(newsletterEmail.address)
      if (subscribedNames.length === 0) {
        logger.info('Failed to get subscribe response', name)
        return null
      }

      // create new subscriptions in db
      const newSubscriptions = subscribedNames.map(
        (name: string): Promise<Subscription> => {
          return getRepository(Subscription).save({
            name,
            newsletterEmail: { id: newsletterEmail.id },
            user: { id: userId },
            status: SubscriptionStatus.Active,
          })
        }
      )

      return Promise.all(newSubscriptions)
    } catch (error) {
      logger.info('Failed to handleSubscribe', error)
      return null
    }
  }

  async _subscribe(email: string): Promise<string[]> {
    return Promise.all([])
  }
}

class AxiosEssentialsHandler extends SubscribeHandler {
  async _subscribe(email: string): Promise<string[]> {
    await axios.post('https://api.axios.com/api/render/readers/unauth-sub/', {
      headers: {
        'content-type': 'application/json',
      },
      body: `{"lists":["newsletter_axiosam","newsletter_axiospm","newsletter_axiosfinishline"],"user_vars":{"source":"axios","medium":null,"campaign":null,"term":null,"content":null,"page":"webflow-newsletters-all"},"email":"${email}"`,
    })

    return ['Axios AM', 'Axios PM', 'Axios Finish Line']
  }
}

class MorningBrewHandler extends SubscribeHandler {
  async _subscribe(email: string): Promise<string[]> {
    await axios.post('https://singularity.morningbrew.com/graphql', {
      headers: {
        'content-type': 'application/json',
      },
      body: `{"operationName":"CreateUserSubscription","variables":{"signupCreateInput":{"email":"${email}","kid":null,"gclid":null,"utmCampaign":"mb","utmMedium":"website","utmSource":"hero-module","utmContent":null,"utmTerm":null,"requestPath":"https://www.morningbrew.com/daily","uiModule":"hero-module"},"signupCreateVerticalSlug":"daily"},"query":"mutation CreateUserSubscription($signupCreateInput: SignupCreateInput!, $signupCreateVerticalSlug: String!) {\\n  signupCreate(input: $signupCreateInput, verticalSlug: $signupCreateVerticalSlug) {\\n    user {\\n      accessToken\\n      email\\n      hasSeenOnboarding\\n      referralCode\\n      verticalSubscriptions {\\n        isActive\\n        vertical {\\n          slug\\n          __typename\\n        }\\n        __typename\\n      }\\n      __typename\\n    }\\n    isNewSubscription\\n    fromAffiliate\\n    subscriptionId\\n    __typename\\n  }\\n}\\n"}`,
    })

    return ['Morning Brew']
  }
}

class MilkRoadHandler extends SubscribeHandler {
  async _subscribe(email: string): Promise<string[]> {
    await axios.post('https://www.milkroad.com/subscriptions', {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: `email=${encodeURIComponent(email)}&commit=Subscribe`,
    })

    return ['Milk Road']
  }
}

class MoneyStuffHandler extends SubscribeHandler {
  async _subscribe(email: string): Promise<string[]> {
    await axios.put(
      `https://login.bloomberg.com/api/newsletters/update?email=${encodeURIComponent(
        email
      )}&source=&notify=true&optIn=false`,
      {
        headers: {
          'content-type': 'application/json',
        },
        body: '{"Money Stuff":true}',
      }
    )

    return ['Money Stuff']
  }
}
